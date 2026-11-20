#pragma once

#include <cstddef>
#include <cstdint>

#include "malha/bytes.hpp"

namespace malha {

constexpr uint8_t kFirmwareMajor = 1;
constexpr uint8_t kFirmwareMinor = 0;
constexpr uint8_t kFirmwarePatch = 0;

constexpr uint8_t kChannelCount = 5;
constexpr uint8_t kOutputCount = 3;
constexpr uint8_t kRuleSlots = 8;
constexpr uint16_t kPwmMax = 1000;
constexpr uint8_t kNoOutput = 0xFF;

enum Channel : uint8_t { Temperature = 0, Light = 1, Level = 2, Supply = 3, Presence = 4 };
enum Output : uint8_t { Relay1 = 0, Relay2 = 1, Fan = 2 };
enum class Comparison : uint8_t { Above = 0, Below = 1 };

enum class EventCode : uint8_t {
  Boot = 1,
  RuleOn = 2,
  RuleOff = 3,
  LinkLost = 4,
  LinkRestored = 5,
  SettingsSaved = 6,
  SettingsReset = 7,
  SensorFault = 8,
  SensorRecovered = 9,
};

struct Calibration {
  float gain = 1.0f;
  float offset = 0.0f;
};

struct Config {
  uint16_t sampleIntervalMs = 1000;
  uint16_t linkTimeoutS = 10;
  uint8_t safeOnLinkLoss = 1;
  uint8_t filterPercent = 30;
  Calibration calibration[kChannelCount] = {};
};

struct Rule {
  uint8_t enabled = 0;
  uint8_t channel = 0;
  Comparison comparison = Comparison::Above;
  float threshold = 0.0f;
  float hysteresis = 0.0f;
  uint16_t delayS = 0;
  uint8_t output = kNoOutput;
  uint16_t onValue = 0;
  uint16_t offValue = 0;
  uint8_t severity = 0;
};

constexpr size_t kConfigWireSize = 2 + 2 + 1 + 1 + kChannelCount * 8;
constexpr size_t kRuleWireSize = 19;

bool isRelay(uint8_t output);
bool validOutputValue(uint8_t output, uint16_t value);
bool validConfig(const Config& config);
bool validCalibration(const Calibration& calibration);
bool validRule(const Rule& rule);

void writeConfig(ByteWriter& writer, const Config& config);
bool readConfig(ByteReader& reader, Config& config);
void writeRule(ByteWriter& writer, const Rule& rule);
bool readRule(ByteReader& reader, Rule& rule);

}
