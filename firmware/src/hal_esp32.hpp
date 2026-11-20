#pragma once

#include <malha/hal.hpp>

namespace malha {

class Esp32Hal final : public Hal {
 public:
  void begin();
  void service(bool linkUp);

  uint32_t millis() override;
  float readChannel(uint8_t channel) override;
  void writeOutput(uint8_t output, uint16_t value) override;
  void send(const uint8_t* data, size_t length) override;
  size_t loadSettings(uint8_t* buffer, size_t capacity) override;
  bool storeSettings(const uint8_t* data, size_t length) override;
  bool eraseSettings() override;
  void reboot() override;
  uint64_t deviceId() override;
  uint8_t bootReason() override;
  uint8_t hardwareModel() override { return 1; }

 private:
  uint8_t bootReason_ = 0;
};

}
