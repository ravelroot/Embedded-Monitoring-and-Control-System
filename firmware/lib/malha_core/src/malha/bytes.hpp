#pragma once

#include <cstddef>
#include <cstdint>
#include <cstring>

namespace malha {

class ByteWriter {
 public:
  ByteWriter(uint8_t* buffer, size_t capacity) : buffer_(buffer), capacity_(capacity) {}

  void u8(uint8_t value) {
    if (ensure(1)) {
      buffer_[size_++] = value;
    }
  }

  void u16(uint16_t value) {
    u8(static_cast<uint8_t>(value & 0xFF));
    u8(static_cast<uint8_t>(value >> 8));
  }

  void u32(uint32_t value) {
    u16(static_cast<uint16_t>(value & 0xFFFF));
    u16(static_cast<uint16_t>(value >> 16));
  }

  void u64(uint64_t value) {
    u32(static_cast<uint32_t>(value & 0xFFFFFFFFu));
    u32(static_cast<uint32_t>(value >> 32));
  }

  void f32(float value) {
    uint32_t bits = 0;
    std::memcpy(&bits, &value, sizeof(bits));
    u32(bits);
  }

  size_t size() const { return size_; }
  bool ok() const { return ok_; }

 private:
  bool ensure(size_t count) {
    if (size_ + count > capacity_) {
      ok_ = false;
      return false;
    }
    return true;
  }

  uint8_t* buffer_;
  size_t capacity_;
  size_t size_ = 0;
  bool ok_ = true;
};

class ByteReader {
 public:
  ByteReader(const uint8_t* buffer, size_t length) : buffer_(buffer), length_(length) {}

  uint8_t u8() {
    if (offset_ + 1 > length_) {
      ok_ = false;
      return 0;
    }
    return buffer_[offset_++];
  }

  uint16_t u16() {
    const uint16_t low = u8();
    const uint16_t high = u8();
    return static_cast<uint16_t>(low | (high << 8));
  }

  uint32_t u32() {
    const uint32_t low = u16();
    const uint32_t high = u16();
    return low | (high << 16);
  }

  uint64_t u64() {
    const uint64_t low = u32();
    const uint64_t high = u32();
    return low | (high << 32);
  }

  float f32() {
    const uint32_t bits = u32();
    float value = 0;
    std::memcpy(&value, &bits, sizeof(value));
    return value;
  }

  size_t remaining() const { return offset_ <= length_ ? length_ - offset_ : 0; }
  bool ok() const { return ok_; }

 private:
  const uint8_t* buffer_;
  size_t length_;
  size_t offset_ = 0;
  bool ok_ = true;
};

}
