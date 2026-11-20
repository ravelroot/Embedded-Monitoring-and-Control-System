#include "malha/sensors.hpp"

#include <cmath>
#include <limits>

namespace malha {

float ntcCelsius(uint16_t raw, uint16_t fullScale, float beta) {
  if (raw == 0 || raw >= fullScale || beta <= 0.0f) {
    return std::numeric_limits<float>::quiet_NaN();
  }
  const float ratio = static_cast<float>(fullScale) / static_cast<float>(raw) - 1.0f;
  return 1.0f / (std::log(1.0f / ratio) / beta + 1.0f / 298.15f) - 273.15f;
}

float rawPercent(uint16_t raw, uint16_t fullScale) {
  if (fullScale == 0) {
    return std::numeric_limits<float>::quiet_NaN();
  }
  const float clamped = raw > fullScale ? static_cast<float>(fullScale) : static_cast<float>(raw);
  return clamped * 100.0f / static_cast<float>(fullScale);
}

float dividerVolts(uint32_t millivolts, float ratio) { return static_cast<float>(millivolts) * ratio / 1000.0f; }

float applyCalibration(float value, const Calibration& calibration) {
  return value * calibration.gain + calibration.offset;
}

void Ema::configure(uint8_t percent) {
  const uint8_t bounded = percent < 1 ? 1 : (percent > 100 ? 100 : percent);
  alpha_ = static_cast<float>(bounded) / 100.0f;
  initialized_ = false;
}

float Ema::update(float sample) {
  if (!std::isfinite(sample)) {
    initialized_ = false;
    return sample;
  }
  if (!initialized_) {
    value_ = sample;
    initialized_ = true;
    return value_;
  }
  value_ += alpha_ * (sample - value_);
  return value_;
}

}
