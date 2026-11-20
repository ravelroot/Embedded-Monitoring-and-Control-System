#pragma once

#include <cstddef>
#include <cstdint>

#include "malha/cobs.hpp"

namespace malha::proto {

constexpr uint8_t kVersion = 1;
constexpr size_t kHeaderSize = 6;
constexpr size_t kCrcSize = 2;
constexpr size_t kMaxBody = 240;
constexpr size_t kMaxPayload = kHeaderSize + kMaxBody + kCrcSize;
constexpr size_t kMaxWire = cobsMaxEncoded(kMaxPayload) + 1;

enum class MsgType : uint8_t {
  Hello = 0x01,
  Ping = 0x02,
  GetConfig = 0x03,
  GetRules = 0x04,
  SetOutput = 0x10,
  SetConfig = 0x11,
  SetCalibration = 0x12,
  SetRule = 0x13,
  ClearRule = 0x14,
  Save = 0x15,
  Reboot = 0x16,
  FactoryReset = 0x17,
  Ack = 0x80,
  Info = 0x81,
  Pong = 0x82,
  Config = 0x83,
  Rules = 0x84,
  Telemetry = 0x90,
  Event = 0x91,
};

enum class Status : uint8_t {
  Ok = 0,
  UnknownType = 1,
  InvalidArgument = 2,
  BadLength = 3,
  StorageError = 4,
};

enum class DecodeResult : uint8_t {
  Ok = 0,
  Cobs = 1,
  TooShort = 2,
  Length = 3,
  Crc = 4,
  Version = 5,
  Overflow = 6,
};

struct Frame {
  uint8_t version = kVersion;
  MsgType type = MsgType::Ping;
  uint16_t seq = 0;
  uint16_t length = 0;
  uint8_t body[kMaxBody] = {};
};

size_t encodeFrame(const Frame& frame, uint8_t* output, size_t capacity);

DecodeResult decodePayload(const uint8_t* payload, size_t length, Frame& frame);

class FrameReader {
 public:
  enum class Result : uint8_t { Pending, Frame, Error };

  Result push(uint8_t byte, Frame& frame);
  DecodeResult lastError() const { return lastError_; }

 private:
  uint8_t buffer_[kMaxWire] = {};
  size_t size_ = 0;
  bool overflow_ = false;
  DecodeResult lastError_ = DecodeResult::Ok;
};

}
