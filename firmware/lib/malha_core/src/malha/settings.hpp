#pragma once

#include <cstddef>
#include <cstdint>

#include "malha/model.hpp"

namespace malha {

constexpr uint32_t kSettingsMagic = 0x31484C4Du;
constexpr uint8_t kSettingsVersion = 1;
constexpr size_t kSettingsSize = 4 + 1 + kConfigWireSize + kRuleSlots * kRuleWireSize + 2;

size_t serializeSettings(const Config& config, const Rule* rules, uint8_t* output, size_t capacity);

bool deserializeSettings(const uint8_t* input, size_t length, Config& config, Rule* rules);

}
