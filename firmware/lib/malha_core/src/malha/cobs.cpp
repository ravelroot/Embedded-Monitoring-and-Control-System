#include "malha/cobs.hpp"

namespace malha {

size_t cobsEncode(const uint8_t* input, size_t length, uint8_t* output, size_t capacity) {
  if (capacity < cobsMaxEncoded(length)) {
    return 0;
  }
  size_t codeIndex = 0;
  size_t writeIndex = 1;
  uint8_t code = 1;
  for (size_t i = 0; i < length; ++i) {
    if (input[i] == 0) {
      output[codeIndex] = code;
      codeIndex = writeIndex++;
      code = 1;
      continue;
    }
    output[writeIndex++] = input[i];
    ++code;
    if (code == 0xFF) {
      output[codeIndex] = code;
      codeIndex = writeIndex++;
      code = 1;
    }
  }
  output[codeIndex] = code;
  return writeIndex;
}

size_t cobsDecode(const uint8_t* input, size_t length, uint8_t* output, size_t capacity) {
  size_t readIndex = 0;
  size_t writeIndex = 0;
  while (readIndex < length) {
    const uint8_t code = input[readIndex];
    if (code == 0 || readIndex + code > length) {
      return 0;
    }
    ++readIndex;
    for (uint8_t i = 1; i < code; ++i) {
      if (writeIndex >= capacity) {
        return 0;
      }
      output[writeIndex++] = input[readIndex++];
    }
    if (code != 0xFF && readIndex < length) {
      if (writeIndex >= capacity) {
        return 0;
      }
      output[writeIndex++] = 0;
    }
  }
  return writeIndex;
}

}
