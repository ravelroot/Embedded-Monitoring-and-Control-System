#include "malha/model.hpp"

#include <cmath>

namespace malha {

namespace {

bool finite(float value) { return std::isfinite(value); }

}

bool isRelay(uint8_t output) { return output == Relay1 || output == Relay2; }

bool validOutputValue(uint8_t output, uint16_t value) {
  if (output >= kOutputCount) {
    return false;
  }
  return isRelay(output) ? value <= 1 : value <= kPwmMax;
}

bool validCalibration(const Calibration& calibration) {
  return finite(calibration.gain) && finite(calibration.offset) && std::fabs(calibration.gain) >= 0.001f &&
         std::fabs(calibration.gain) <= 1000.0f && std::fabs(calibration.offset) <= 10000.0f;
}

bool validConfig(const Config& config) {
  if (config.sampleIntervalMs < 100 || config.sampleIntervalMs > 60000) {
    return false;
  }
  if (config.linkTimeoutS > 3600 || config.safeOnLinkLoss > 1 || config.filterPercent < 1 || config.filterPercent > 100) {
    return false;
  }
  for (const Calibration& calibration : config.calibration) {
    if (!validCalibration(calibration)) {
      return false;
    }
  }
  return true;
}

bool validRule(const Rule& rule) {
  if (rule.enabled > 1 || rule.channel >= kChannelCount || rule.severity > 3 || rule.delayS > 3600) {
    return false;
  }
  if (rule.comparison != Comparison::Above && rule.comparison != Comparison::Below) {
    return false;
  }
  if (!finite(rule.threshold) || !finite(rule.hysteresis) || rule.hysteresis < 0.0f) {
    return false;
  }
  if (rule.output == kNoOutput) {
    return rule.enabled == 0 || rule.severity > 0;
  }
  return validOutputValue(rule.output, rule.onValue) && validOutputValue(rule.output, rule.offValue);
}

void writeConfig(ByteWriter& writer, const Config& config) {
  writer.u16(config.sampleIntervalMs);
  writer.u16(config.linkTimeoutS);
  writer.u8(config.safeOnLinkLoss);
  writer.u8(config.filterPercent);
  for (const Calibration& calibration : config.calibration) {
    writer.f32(calibration.gain);
    writer.f32(calibration.offset);
  }
}

bool readConfig(ByteReader& reader, Config& config) {
  Config parsed;
  parsed.sampleIntervalMs = reader.u16();
  parsed.linkTimeoutS = reader.u16();
  parsed.safeOnLinkLoss = reader.u8();
  parsed.filterPercent = reader.u8();
  for (Calibration& calibration : parsed.calibration) {
    calibration.gain = reader.f32();
    calibration.offset = reader.f32();
  }
  if (!reader.ok() || !validConfig(parsed)) {
    return false;
  }
  config = parsed;
  return true;
}

void writeRule(ByteWriter& writer, const Rule& rule) {
  writer.u8(rule.enabled);
  writer.u8(rule.channel);
  writer.u8(static_cast<uint8_t>(rule.comparison));
  writer.f32(rule.threshold);
  writer.f32(rule.hysteresis);
  writer.u16(rule.delayS);
  writer.u8(rule.output);
  writer.u16(rule.onValue);
  writer.u16(rule.offValue);
  writer.u8(rule.severity);
}

bool readRule(ByteReader& reader, Rule& rule) {
  Rule parsed;
  parsed.enabled = reader.u8();
  parsed.channel = reader.u8();
  parsed.comparison = static_cast<Comparison>(reader.u8());
  parsed.threshold = reader.f32();
  parsed.hysteresis = reader.f32();
  parsed.delayS = reader.u16();
  parsed.output = reader.u8();
  parsed.onValue = reader.u16();
  parsed.offValue = reader.u16();
  parsed.severity = reader.u8();
  if (!reader.ok() || !validRule(parsed)) {
    return false;
  }
  rule = parsed;
  return true;
}

}
