#include "malha/controller.hpp"

#include <cmath>

#include "malha/bytes.hpp"
#include "malha/settings.hpp"

namespace malha {

using proto::MsgType;
using proto::Status;

void Controller::begin() {
  applyDefaults();
  loadSettings();
  configureFilters();
  for (uint8_t index = 0; index < kOutputCount; ++index) {
    setOutput(index, 0, false);
  }
  const uint32_t now = hal_.millis();
  sendEvent(EventCode::Boot, 0, hal_.bootReason(), 0.0f, now);
  sample(now);
}

void Controller::onByte(uint8_t byte) {
  const proto::FrameReader::Result result = reader_.push(byte, rx_);
  if (result == proto::FrameReader::Result::Frame) {
    handle(rx_, hal_.millis());
  } else if (result == proto::FrameReader::Result::Error) {
    ++frameErrors_;
  }
}

void Controller::tick() {
  const uint32_t now = hal_.millis();
  checkLink(now);
  if (now - lastSampleMs_ >= config_.sampleIntervalMs) {
    sample(now);
  }
}

void Controller::handle(const proto::Frame& frame, uint32_t now) {
  lastHostMs_ = now;
  if (!linkUp_) {
    linkUp_ = true;
    if (hostSeen_) {
      sendEvent(EventCode::LinkRestored, 0, 0, 0.0f, now);
    }
    hostSeen_ = true;
  }
  ByteReader reader(frame.body, frame.length);
  switch (frame.type) {
    case MsgType::Hello:
      sendInfo(frame.seq, now);
      return;
    case MsgType::Ping: {
      if (frame.length != 4) {
        ack(frame.seq, frame.type, Status::BadLength);
        return;
      }
      reply(MsgType::Pong, frame.seq, frame.body, 4);
      return;
    }
    case MsgType::GetConfig:
      sendConfig(frame.seq);
      return;
    case MsgType::GetRules:
      sendRules(frame.seq);
      return;
    case MsgType::SetOutput: {
      if (frame.length != 3) {
        ack(frame.seq, frame.type, Status::BadLength);
        return;
      }
      const uint8_t index = reader.u8();
      const uint16_t value = reader.u16();
      if (!validOutputValue(index, value)) {
        ack(frame.seq, frame.type, Status::InvalidArgument);
        return;
      }
      setOutput(index, value, true);
      ack(frame.seq, frame.type, Status::Ok);
      sendTelemetry(now);
      return;
    }
    case MsgType::SetConfig: {
      if (frame.length != kConfigWireSize) {
        ack(frame.seq, frame.type, Status::BadLength);
        return;
      }
      if (!readConfig(reader, config_)) {
        ack(frame.seq, frame.type, Status::InvalidArgument);
        return;
      }
      configureFilters();
      dirty_ = true;
      ack(frame.seq, frame.type, Status::Ok);
      return;
    }
    case MsgType::SetCalibration: {
      if (frame.length != 9) {
        ack(frame.seq, frame.type, Status::BadLength);
        return;
      }
      const uint8_t channel = reader.u8();
      Calibration calibration;
      calibration.gain = reader.f32();
      calibration.offset = reader.f32();
      if (channel >= kChannelCount || !validCalibration(calibration)) {
        ack(frame.seq, frame.type, Status::InvalidArgument);
        return;
      }
      config_.calibration[channel] = calibration;
      filters_[channel].reset();
      dirty_ = true;
      ack(frame.seq, frame.type, Status::Ok);
      return;
    }
    case MsgType::SetRule: {
      if (frame.length != 1 + kRuleWireSize) {
        ack(frame.seq, frame.type, Status::BadLength);
        return;
      }
      const uint8_t slot = reader.u8();
      Rule rule;
      if (slot >= kRuleSlots || !readRule(reader, rule)) {
        ack(frame.seq, frame.type, Status::InvalidArgument);
        return;
      }
      releaseRule(slot, now);
      engine_.set(slot, rule);
      dirty_ = true;
      ack(frame.seq, frame.type, Status::Ok);
      return;
    }
    case MsgType::ClearRule: {
      if (frame.length != 1) {
        ack(frame.seq, frame.type, Status::BadLength);
        return;
      }
      const uint8_t slot = reader.u8();
      if (slot >= kRuleSlots) {
        ack(frame.seq, frame.type, Status::InvalidArgument);
        return;
      }
      releaseRule(slot, now);
      engine_.clear(slot);
      dirty_ = true;
      ack(frame.seq, frame.type, Status::Ok);
      return;
    }
    case MsgType::Save: {
      const bool saved = saveSettings();
      ack(frame.seq, frame.type, saved ? Status::Ok : Status::StorageError);
      if (saved) {
        sendEvent(EventCode::SettingsSaved, 0, 0, 0.0f, now);
      }
      return;
    }
    case MsgType::Reboot:
      ack(frame.seq, frame.type, Status::Ok);
      hal_.reboot();
      return;
    case MsgType::FactoryReset: {
      for (uint8_t slot = 0; slot < kRuleSlots; ++slot) {
        releaseRule(slot, now);
      }
      const bool erased = hal_.eraseSettings();
      applyDefaults();
      configureFilters();
      for (uint8_t index = 0; index < kOutputCount; ++index) {
        setOutput(index, 0, false);
      }
      dirty_ = false;
      ack(frame.seq, frame.type, erased ? Status::Ok : Status::StorageError);
      sendEvent(EventCode::SettingsReset, 1, 0, 0.0f, now);
      return;
    }
    default:
      ack(frame.seq, frame.type, Status::UnknownType);
      return;
  }
}

void Controller::reply(MsgType type, uint16_t seq, const uint8_t* body, size_t length) {
  proto::Frame frame;
  frame.type = type;
  frame.seq = seq;
  frame.length = static_cast<uint16_t>(length);
  for (size_t i = 0; i < length && i < proto::kMaxBody; ++i) {
    frame.body[i] = body[i];
  }
  uint8_t wire[proto::kMaxWire];
  const size_t size = proto::encodeFrame(frame, wire, sizeof(wire));
  if (size > 0) {
    hal_.send(wire, size);
  }
}

void Controller::ack(uint16_t seq, MsgType reference, Status status) {
  const uint8_t body[2] = {static_cast<uint8_t>(reference), static_cast<uint8_t>(status)};
  reply(MsgType::Ack, seq, body, sizeof(body));
}

void Controller::sendInfo(uint16_t seq, uint32_t now) {
  uint8_t body[32];
  ByteWriter writer(body, sizeof(body));
  writer.u8(proto::kVersion);
  writer.u8(kFirmwareMajor);
  writer.u8(kFirmwareMinor);
  writer.u8(kFirmwarePatch);
  writer.u64(hal_.deviceId());
  writer.u8(kChannelCount);
  writer.u8(kOutputCount);
  writer.u8(kRuleSlots);
  writer.u32(now);
  writer.u8(hal_.bootReason());
  writer.u8(hal_.hardwareModel());
  reply(MsgType::Info, seq, body, writer.size());
}

void Controller::sendConfig(uint16_t seq) {
  uint8_t body[kConfigWireSize];
  ByteWriter writer(body, sizeof(body));
  writeConfig(writer, config_);
  reply(MsgType::Config, seq, body, writer.size());
}

void Controller::sendRules(uint16_t seq) {
  uint8_t body[1 + kRuleSlots * (2 + kRuleWireSize)];
  ByteWriter writer(body, sizeof(body));
  writer.u8(kRuleSlots);
  for (uint8_t slot = 0; slot < kRuleSlots; ++slot) {
    writer.u8(slot);
    writer.u8(engine_.active(slot) ? 1 : 0);
    writeRule(writer, engine_.rule(slot));
  }
  reply(MsgType::Rules, seq, body, writer.size());
}

void Controller::sendTelemetry(uint32_t now) {
  uint8_t body[48];
  ByteWriter writer(body, sizeof(body));
  uint8_t flags = 0;
  for (uint8_t channel = 0; channel < kChannelCount; ++channel) {
    if (!valid_[channel]) {
      flags = static_cast<uint8_t>(flags | 0x02);
    }
  }
  if (linkUp_) {
    flags = static_cast<uint8_t>(flags | 0x01);
  }
  if (dirty_) {
    flags = static_cast<uint8_t>(flags | 0x04);
  }
  writer.u32(now);
  writer.u8(flags);
  writer.u8(kChannelCount);
  for (float value : values_) {
    writer.f32(value);
  }
  writer.u8(kOutputCount);
  for (uint16_t value : outputs_) {
    writer.u16(value);
  }
  writer.u8(engine_.activeMask());
  reply(MsgType::Telemetry, txSeq_++, body, writer.size());
}

void Controller::sendEvent(EventCode code, uint8_t severity, uint8_t index, float value, uint32_t now) {
  uint8_t body[16];
  ByteWriter writer(body, sizeof(body));
  writer.u8(static_cast<uint8_t>(code));
  writer.u8(severity);
  writer.u8(index);
  writer.f32(value);
  writer.u32(now);
  reply(MsgType::Event, txSeq_++, body, writer.size());
}

void Controller::sample(uint32_t now) {
  lastSampleMs_ = now;
  for (uint8_t channel = 0; channel < kChannelCount; ++channel) {
    const float raw = hal_.readChannel(channel);
    const bool ok = std::isfinite(raw);
    if (!ok) {
      values_[channel] = raw;
      filters_[channel].reset();
    } else {
      const float calibrated = applyCalibration(raw, config_.calibration[channel]);
      values_[channel] = channel == Presence ? calibrated : filters_[channel].update(calibrated);
    }
    valid_[channel] = ok;
    if (!ok && !faulted_[channel]) {
      faulted_[channel] = true;
      sendEvent(EventCode::SensorFault, 2, channel, 0.0f, now);
    } else if (ok && faulted_[channel]) {
      faulted_[channel] = false;
      sendEvent(EventCode::SensorRecovered, 0, channel, values_[channel], now);
    }
  }
  RuleTransition transitions[kRuleSlots];
  const size_t count = engine_.evaluate(values_, valid_, now, transitions, kRuleSlots);
  for (size_t i = 0; i < count; ++i) {
    applyTransition(transitions[i], now);
  }
  sendTelemetry(now);
}

void Controller::applyTransition(const RuleTransition& transition, uint32_t now) {
  const Rule& rule = engine_.rule(transition.slot);
  if (rule.output != kNoOutput) {
    setOutput(rule.output, transition.active ? rule.onValue : rule.offValue, false);
  }
  sendEvent(transition.active ? EventCode::RuleOn : EventCode::RuleOff, transition.active ? rule.severity : 0,
            transition.slot, transition.value, now);
}

void Controller::releaseRule(uint8_t slot, uint32_t now) {
  if (!engine_.active(slot)) {
    return;
  }
  const Rule& rule = engine_.rule(slot);
  if (rule.output != kNoOutput) {
    setOutput(rule.output, rule.offValue, false);
  }
  sendEvent(EventCode::RuleOff, 0, slot, values_[rule.channel], now);
}

void Controller::setOutput(uint8_t index, uint16_t value, bool manual) {
  if (index >= kOutputCount) {
    return;
  }
  outputs_[index] = value;
  manual_[index] = manual;
  hal_.writeOutput(index, value);
}

void Controller::checkLink(uint32_t now) {
  if (!linkUp_ || config_.linkTimeoutS == 0) {
    return;
  }
  if (now - lastHostMs_ <= static_cast<uint32_t>(config_.linkTimeoutS) * 1000u) {
    return;
  }
  linkUp_ = false;
  sendEvent(EventCode::LinkLost, 2, 0, 0.0f, now);
  if (config_.safeOnLinkLoss == 0) {
    return;
  }
  for (uint8_t index = 0; index < kOutputCount; ++index) {
    if (manual_[index]) {
      setOutput(index, 0, false);
    }
  }
}

void Controller::configureFilters() {
  for (Ema& filter : filters_) {
    filter.configure(config_.filterPercent);
  }
}

void Controller::applyDefaults() {
  config_ = Config{};
  engine_.clearAll();
}

void Controller::loadSettings() {
  uint8_t buffer[kSettingsSize];
  const size_t length = hal_.loadSettings(buffer, sizeof(buffer));
  if (length == 0) {
    return;
  }
  Config config;
  Rule rules[kRuleSlots];
  if (!deserializeSettings(buffer, length, config, rules)) {
    return;
  }
  config_ = config;
  for (uint8_t slot = 0; slot < kRuleSlots; ++slot) {
    engine_.set(slot, rules[slot]);
  }
}

bool Controller::saveSettings() {
  Rule rules[kRuleSlots];
  for (uint8_t slot = 0; slot < kRuleSlots; ++slot) {
    rules[slot] = engine_.rule(slot);
  }
  uint8_t buffer[kSettingsSize];
  const size_t length = serializeSettings(config_, rules, buffer, sizeof(buffer));
  if (length == 0 || !hal_.storeSettings(buffer, length)) {
    return false;
  }
  dirty_ = false;
  return true;
}

}
