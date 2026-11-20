#pragma once

#include <cstdint>

#include "malha/model.hpp"

namespace malha {

float ntcCelsius(uint16_t raw, uint16_t fullScale, float beta = 3950.0f);
float rawPercent(uint16_t raw, uint16_t fullScale);
float dividerVolts(uint32_t millivolts, float ratio);
float applyCalibration(float value, const Calibration& calibration);

class Ema {
 public:
  void configure(uint8_t percent);
  void reset() { initialized_ = false; }
  float update(float sample);

 private:
  float alpha_ = 0.3f;
  float value_ = 0.0f;
  bool initialized_ = false;
};

}
