#include <Arduino.h>

#include <malha/controller.hpp>

#include "hal_esp32.hpp"

namespace {

malha::Esp32Hal hal;
malha::Controller controller(hal);

}

void setup() {
  hal.begin();
  controller.begin();
}

void loop() {
  int budget = 512;
  while (Serial.available() > 0 && budget-- > 0) {
    controller.onByte(static_cast<uint8_t>(Serial.read()));
  }
  controller.tick();
  hal.service(controller.linkUp());
  delay(2);
}
