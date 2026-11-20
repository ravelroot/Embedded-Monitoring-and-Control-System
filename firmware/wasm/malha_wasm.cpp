#include <new>

#include <malha/controller.hpp>

#define MALHA_IMPORT(name) __attribute__((import_module("host"), import_name(name)))
#define MALHA_EXPORT(name) __attribute__((export_name(name)))

extern "C" {
MALHA_IMPORT("millis") uint32_t host_millis();
MALHA_IMPORT("read_channel") float host_read_channel(uint32_t channel);
MALHA_IMPORT("write_output") void host_write_output(uint32_t output, uint32_t value);
MALHA_IMPORT("send") void host_send(const uint8_t* data, uint32_t length);
MALHA_IMPORT("load") uint32_t host_load(uint8_t* buffer, uint32_t capacity);
MALHA_IMPORT("store") uint32_t host_store(const uint8_t* data, uint32_t length);
MALHA_IMPORT("erase") uint32_t host_erase();
MALHA_IMPORT("reboot") void host_reboot();
}

namespace {

class WasmHal final : public malha::Hal {
 public:
  uint32_t millis() override { return host_millis(); }
  float readChannel(uint8_t channel) override { return host_read_channel(channel); }
  void writeOutput(uint8_t output, uint16_t value) override { host_write_output(output, value); }
  void send(const uint8_t* data, size_t length) override { host_send(data, static_cast<uint32_t>(length)); }
  size_t loadSettings(uint8_t* buffer, size_t capacity) override {
    return host_load(buffer, static_cast<uint32_t>(capacity));
  }
  bool storeSettings(const uint8_t* data, size_t length) override {
    return host_store(data, static_cast<uint32_t>(length)) == length;
  }
  bool eraseSettings() override { return host_erase() != 0; }
  void reboot() override { host_reboot(); }
  uint64_t deviceId() override { return 0x00004D414C4841ull; }
  uint8_t bootReason() override { return 1; }
  uint8_t hardwareModel() override { return 2; }
};

WasmHal hal;
alignas(malha::Controller) unsigned char controllerStorage[sizeof(malha::Controller)];
malha::Controller* controller = nullptr;
uint8_t inputBuffer[4096];

}

extern "C" {

MALHA_EXPORT("malha_begin") void malha_begin() {
  controller = new (controllerStorage) malha::Controller(hal);
  controller->begin();
}

MALHA_EXPORT("malha_input_buffer") uint8_t* malha_input_buffer() { return inputBuffer; }

MALHA_EXPORT("malha_input_capacity") uint32_t malha_input_capacity() { return sizeof(inputBuffer); }

MALHA_EXPORT("malha_receive") void malha_receive(uint32_t length) {
  if (controller == nullptr) {
    return;
  }
  const uint32_t bounded = length > sizeof(inputBuffer) ? sizeof(inputBuffer) : length;
  for (uint32_t i = 0; i < bounded; ++i) {
    controller->onByte(inputBuffer[i]);
  }
}

MALHA_EXPORT("malha_tick") void malha_tick() {
  if (controller != nullptr) {
    controller->tick();
  }
}

MALHA_EXPORT("malha_link_up") uint32_t malha_link_up() { return controller != nullptr && controller->linkUp() ? 1 : 0; }

}
