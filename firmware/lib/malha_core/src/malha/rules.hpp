#pragma once

#include <cstddef>
#include <cstdint>

#include "malha/model.hpp"

namespace malha {

struct RuleTransition {
  uint8_t slot = 0;
  bool active = false;
  float value = 0.0f;
};

class RuleEngine {
 public:
  bool set(uint8_t slot, const Rule& rule);
  bool clear(uint8_t slot);
  void clearAll();
  const Rule& rule(uint8_t slot) const { return rules_[slot < kRuleSlots ? slot : 0]; }
  bool active(uint8_t slot) const { return slot < kRuleSlots && active_[slot]; }
  uint8_t activeMask() const;
  size_t evaluate(const float* values, const bool* valid, uint32_t nowMs, RuleTransition* output, size_t capacity);

 private:
  static bool triggers(const Rule& rule, float value);
  static bool releases(const Rule& rule, float value);

  Rule rules_[kRuleSlots] = {};
  bool active_[kRuleSlots] = {};
  bool pending_[kRuleSlots] = {};
  uint32_t since_[kRuleSlots] = {};
};

}
