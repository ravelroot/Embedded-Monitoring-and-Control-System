#pragma once

#include <cstddef>
#include <cstdint>

namespace malha {

constexpr size_t cobsMaxEncoded(size_t length) { return length + length / 254 + 1; }

size_t cobsEncode(const uint8_t* input, size_t length, uint8_t* output, size_t capacity);

size_t cobsDecode(const uint8_t* input, size_t length, uint8_t* output, size_t capacity);

}
