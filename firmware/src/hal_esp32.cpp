#include "hal_esp32.hpp"

#include <Arduino.h>
#include <Preferences.h>
#include <esp_system.h>
#include <esp_task_wdt.h>

#include <limits>

#include <malha/model.hpp>
#include <malha/sensors.hpp>

#include "pins.hpp"

namespace malha {

namespace {

constexpr const char* kNamespace = "malha";
constexpr const char* kSettingsKey = "settings";

Preferences preferences;

void configureWatchdog() {
#if ESP_ARDUINO_VERSION_MAJOR >= 3
  esp_task_wdt_config_t config = {};
  config.timeout_ms = pins::kWatchdogSeconds * 1000;
  config.idle_core_mask = 0;
  config.trigger_panic = true;
  esp_task_wdt_reconfigure(&config);
#else
  esp_task_wdt_init(pins::kWatchdogSeconds, true);
#endif
  esp_task_wdt_add(nullptr);
}

void configureFan() {
#if ESP_ARDUINO_VERSION_MAJOR >= 3
  ledcAttach(pins::kFan, pins::kFanFrequencyHz, pins::kFanResolutionBits);
#else
  ledcSetup(pins::kFanLedcChannel, pins::kFanFrequencyHz, pins::kFanResolutionBits);
  ledcAttachPin(pins::kFan, pins::kFanLedcChannel);
#endif
}

void writeFan(uint32_t duty) {
#if ESP_ARDUINO_VERSION_MAJOR >= 3
  ledcWrite(pins::kFan, duty);
#else
  ledcWrite(pins::kFanLedcChannel, duty);
#endif
}

uint16_t readAveraged(uint8_t pin) {
  uint32_t sum = 0;
  for (int i = 0; i < 8; ++i) {
    sum += static_cast<uint32_t>(analogRead(pin));
  }
  return static_cast<uint16_t>(sum / 8);
}

}

void Esp32Hal::begin() {
  Serial.setRxBufferSize(1024);
  Serial.begin(pins::kSerialBaud);
  bootReason_ = static_cast<uint8_t>(esp_reset_reason());
  analogReadResolution(12);
  analogSetAttenuation(ADC_11db);
  pinMode(pins::kPresence, INPUT);
  pinMode(pins::kRelay1, OUTPUT);
  pinMode(pins::kRelay2, OUTPUT);
  pinMode(pins::kStatusLed, OUTPUT);
  digitalWrite(pins::kRelay1, LOW);
  digitalWrite(pins::kRelay2, LOW);
  configureFan();
  writeFan(0);
  preferences.begin(kNamespace, false);
  configureWatchdog();
}

void Esp32Hal::service(bool linkUp) {
  esp_task_wdt_reset();
  const uint32_t period = linkUp ? 1000 : 250;
  const uint32_t phase = ::millis() % period;
  digitalWrite(pins::kStatusLed, phase < period / 8 ? HIGH : LOW);
}

uint32_t Esp32Hal::millis() { return ::millis(); }

float Esp32Hal::readChannel(uint8_t channel) {
  switch (channel) {
    case Temperature:
      return ntcCelsius(readAveraged(pins::kTemperature), pins::kAdcFullScale);
    case Light:
      return 100.0f - rawPercent(readAveraged(pins::kLight), pins::kAdcFullScale);
    case Level:
      return rawPercent(readAveraged(pins::kLevel), pins::kAdcFullScale);
    case Supply:
      return dividerVolts(analogReadMilliVolts(pins::kSupply), pins::kSupplyDividerRatio);
    case Presence:
      return digitalRead(pins::kPresence) == HIGH ? 1.0f : 0.0f;
    default:
      return std::numeric_limits<float>::quiet_NaN();
  }
}

void Esp32Hal::writeOutput(uint8_t output, uint16_t value) {
  switch (output) {
    case Relay1:
      digitalWrite(pins::kRelay1, value != 0 ? HIGH : LOW);
      return;
    case Relay2:
      digitalWrite(pins::kRelay2, value != 0 ? HIGH : LOW);
      return;
    case Fan: {
      const uint32_t maxDuty = (1u << pins::kFanResolutionBits) - 1u;
      writeFan(static_cast<uint32_t>(value) * maxDuty / kPwmMax);
      return;
    }
    default:
      return;
  }
}

void Esp32Hal::send(const uint8_t* data, size_t length) { Serial.write(data, length); }

size_t Esp32Hal::loadSettings(uint8_t* buffer, size_t capacity) {
  const size_t length = preferences.getBytesLength(kSettingsKey);
  if (length == 0 || length > capacity) {
    return 0;
  }
  return preferences.getBytes(kSettingsKey, buffer, capacity);
}

bool Esp32Hal::storeSettings(const uint8_t* data, size_t length) {
  return preferences.putBytes(kSettingsKey, data, length) == length;
}

bool Esp32Hal::eraseSettings() {
  if (!preferences.isKey(kSettingsKey)) {
    return true;
  }
  return preferences.remove(kSettingsKey);
}

void Esp32Hal::reboot() {
  Serial.flush();
  delay(50);
  ESP.restart();
}

uint64_t Esp32Hal::deviceId() { return ESP.getEfuseMac(); }

uint8_t Esp32Hal::bootReason() { return bootReason_; }

}
