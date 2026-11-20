#include "malha/rules.hpp"

namespace malha {

bool RuleEngine::set(uint8_t slot, const Rule& rule) {
  if (slot >= kRuleSlots || !validRule(rule)) {
    return false;
  }
  rules_[slot] = rule;
  active_[slot] = false;
  pending_[slot] = false;
  since_[slot] = 0;
  return true;
}

bool RuleEngine::clear(uint8_t slot) {
  if (slot >= kRuleSlots) {
    return false;
  }
  rules_[slot] = Rule{};
  active_[slot] = false;
  pending_[slot] = false;
  since_[slot] = 0;
  return true;
}

void RuleEngine::clearAll() {
  for (uint8_t slot = 0; slot < kRuleSlots; ++slot) {
    clear(slot);
  }
}

uint8_t RuleEngine::activeMask() const {
  uint8_t mask = 0;
  for (uint8_t slot = 0; slot < kRuleSlots; ++slot) {
    if (active_[slot]) {
      mask = static_cast<uint8_t>(mask | (1u << slot));
    }
  }
  return mask;
}

bool RuleEngine::triggers(const Rule& rule, float value) {
  return rule.comparison == Comparison::Above ? value > rule.threshold : value < rule.threshold;
}

bool RuleEngine::releases(const Rule& rule, float value) {
  return rule.comparison == Comparison::Above ? value < rule.threshold - rule.hysteresis
                                              : value > rule.threshold + rule.hysteresis;
}

size_t RuleEngine::evaluate(const float* values, const bool* valid, uint32_t nowMs, RuleTransition* output,
                            size_t capacity) {
  size_t count = 0;
  for (uint8_t slot = 0; slot < kRuleSlots; ++slot) {
    const Rule& rule = rules_[slot];
    if (rule.enabled == 0) {
      continue;
    }
    if (!valid[rule.channel]) {
      pending_[slot] = false;
      continue;
    }
    const float value = values[rule.channel];
    bool changed = false;
    if (active_[slot]) {
      if (releases(rule, value)) {
        active_[slot] = false;
        pending_[slot] = false;
        changed = true;
      }
    } else if (triggers(rule, value)) {
      if (!pending_[slot]) {
        pending_[slot] = true;
        since_[slot] = nowMs;
      }
      if (nowMs - since_[slot] >= static_cast<uint32_t>(rule.delayS) * 1000u) {
        active_[slot] = true;
        pending_[slot] = false;
        changed = true;
      }
    } else {
      pending_[slot] = false;
    }
    if (changed && count < capacity) {
      output[count].slot = slot;
      output[count].active = active_[slot];
      output[count].value = value;
      ++count;
    }
  }
  return count;
}

}
