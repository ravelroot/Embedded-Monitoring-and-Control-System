#pragma once

#include <cstddef>
#include <cstdint>

namespace malha {

uint16_t crc16(const uint8_t* data, size_t length, uint16_t seed = 0xFFFF);

}
