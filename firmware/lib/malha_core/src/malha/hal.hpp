#pragma once

#include <cstddef>
#include <cstdint>

namespace malha {

class Hal {
 public:
  virtual ~Hal() = default;
  virtual uint32_t millis() = 0;
  virtual float readChannel(uint8_t channel) = 0;
  virtual void writeOutput(uint8_t output, uint16_t value) = 0;
  virtual void send(const uint8_t* data, size_t length) = 0;
  virtual size_t loadSettings(uint8_t* buffer, size_t capacity) = 0;
  virtual bool storeSettings(const uint8_t* data, size_t length) = 0;
  virtual bool eraseSettings() = 0;
  virtual void reboot() = 0;
  virtual uint64_t deviceId() = 0;
  virtual uint8_t bootReason() = 0;
  virtual uint8_t hardwareModel() = 0;
};

}
