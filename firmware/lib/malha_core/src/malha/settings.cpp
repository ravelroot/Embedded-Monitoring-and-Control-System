#include "malha/settings.hpp"

#include "malha/crc16.hpp"

namespace malha {

size_t serializeSettings(const Config& config, const Rule* rules, uint8_t* output, size_t capacity) {
  if (capacity < kSettingsSize) {
    return 0;
  }
  ByteWriter writer(output, capacity);
  writer.u32(kSettingsMagic);
  writer.u8(kSettingsVersion);
  writeConfig(writer, config);
  for (uint8_t slot = 0; slot < kRuleSlots; ++slot) {
    writeRule(writer, rules[slot]);
  }
  writer.u16(crc16(output, writer.size()));
  return writer.ok() ? writer.size() : 0;
}

bool deserializeSettings(const uint8_t* input, size_t length, Config& config, Rule* rules) {
  if (length != kSettingsSize) {
    return false;
  }
  const uint16_t expected = static_cast<uint16_t>(input[length - 2] | (input[length - 1] << 8));
  if (crc16(input, length - 2) != expected) {
    return false;
  }
  ByteReader reader(input, length - 2);
  if (reader.u32() != kSettingsMagic || reader.u8() != kSettingsVersion) {
    return false;
  }
  Config parsedConfig;
  if (!readConfig(reader, parsedConfig)) {
    return false;
  }
  Rule parsedRules[kRuleSlots];
  for (Rule& rule : parsedRules) {
    if (!readRule(reader, rule)) {
      return false;
    }
  }
  config = parsedConfig;
  for (uint8_t slot = 0; slot < kRuleSlots; ++slot) {
    rules[slot] = parsedRules[slot];
  }
  return true;
}

}
