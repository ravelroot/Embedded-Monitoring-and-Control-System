#pragma once

#include <cstdint>

namespace malha::pins {

constexpr uint8_t kTemperature = 34;
constexpr uint8_t kLight = 35;
constexpr uint8_t kLevel = 32;
constexpr uint8_t kSupply = 33;
constexpr uint8_t kPresence = 27;
constexpr uint8_t kRelay1 = 26;
constexpr uint8_t kRelay2 = 25;
constexpr uint8_t kFan = 14;
constexpr uint8_t kStatusLed = 2;

constexpr uint32_t kFanFrequencyHz = 25000;
constexpr uint8_t kFanResolutionBits = 10;
constexpr uint8_t kFanLedcChannel = 0;
constexpr uint16_t kAdcFullScale = 4095;
constexpr float kSupplyDividerRatio = 2.0f;
constexpr uint32_t kSerialBaud = 115200;
constexpr uint32_t kWatchdogSeconds = 5;

}
