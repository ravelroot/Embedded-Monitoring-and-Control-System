#pragma once

#include <cstddef>
#include <cstdint>

#include "malha/hal.hpp"
#include "malha/model.hpp"
#include "malha/protocol.hpp"
#include "malha/rules.hpp"
#include "malha/sensors.hpp"

namespace malha {

class Controller {
 public:
  explicit Controller(Hal& hal) : hal_(hal) {}

  void begin();
  void onByte(uint8_t byte);
  void tick();

  bool linkUp() const { return linkUp_; }
  bool dirty() const { return dirty_; }
  const Config& config() const { return config_; }
  const RuleEngine& rules() const { return engine_; }
  float value(uint8_t channel) const { return values_[channel]; }
  uint16_t output(uint8_t index) const { return outputs_[index]; }
  uint32_t frameErrors() const { return frameErrors_; }

 private:
  void handle(const proto::Frame& frame, uint32_t now);
  void reply(proto::MsgType type, uint16_t seq, const uint8_t* body, size_t length);
  void ack(uint16_t seq, proto::MsgType reference, proto::Status status);
  void sendInfo(uint16_t seq, uint32_t now);
  void sendConfig(uint16_t seq);
  void sendRules(uint16_t seq);
  void sendTelemetry(uint32_t now);
  void sendEvent(EventCode code, uint8_t severity, uint8_t index, float value, uint32_t now);
  void sample(uint32_t now);
  void applyTransition(const RuleTransition& transition, uint32_t now);
  void releaseRule(uint8_t slot, uint32_t now);
  void setOutput(uint8_t index, uint16_t value, bool manual);
  void checkLink(uint32_t now);
  void configureFilters();
  void applyDefaults();
  void loadSettings();
  bool saveSettings();

  Hal& hal_;
  Config config_;
  RuleEngine engine_;
  proto::FrameReader reader_;
  proto::Frame rx_;
  Ema filters_[kChannelCount];
  float values_[kChannelCount] = {};
  bool valid_[kChannelCount] = {};
  bool faulted_[kChannelCount] = {};
  uint16_t outputs_[kOutputCount] = {};
  bool manual_[kOutputCount] = {};
  uint32_t lastSampleMs_ = 0;
  uint32_t lastHostMs_ = 0;
  uint32_t frameErrors_ = 0;
  uint16_t txSeq_ = 0;
  bool linkUp_ = false;
  bool hostSeen_ = false;
  bool dirty_ = false;
};

}
