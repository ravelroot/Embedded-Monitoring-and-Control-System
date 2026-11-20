#include "malha/protocol.hpp"

#include "malha/bytes.hpp"
#include "malha/crc16.hpp"

namespace malha::proto {

size_t encodeFrame(const Frame& frame, uint8_t* output, size_t capacity) {
  if (frame.length > kMaxBody) {
    return 0;
  }
  uint8_t payload[kMaxPayload];
  ByteWriter writer(payload, sizeof(payload));
  writer.u8(frame.version);
  writer.u8(static_cast<uint8_t>(frame.type));
  writer.u16(frame.seq);
  writer.u16(frame.length);
  for (uint16_t i = 0; i < frame.length; ++i) {
    writer.u8(frame.body[i]);
  }
  writer.u16(crc16(payload, writer.size()));
  if (!writer.ok() || capacity < 1) {
    return 0;
  }
  const size_t encoded = cobsEncode(payload, writer.size(), output, capacity - 1);
  if (encoded == 0) {
    return 0;
  }
  output[encoded] = 0;
  return encoded + 1;
}

DecodeResult decodePayload(const uint8_t* payload, size_t length, Frame& frame) {
  if (length < kHeaderSize + kCrcSize) {
    return DecodeResult::TooShort;
  }
  ByteReader reader(payload, length);
  frame.version = reader.u8();
  frame.type = static_cast<MsgType>(reader.u8());
  frame.seq = reader.u16();
  frame.length = reader.u16();
  if (frame.length > kMaxBody || length != kHeaderSize + frame.length + kCrcSize) {
    return DecodeResult::Length;
  }
  const uint16_t expected = static_cast<uint16_t>(payload[length - 2] | (payload[length - 1] << 8));
  if (crc16(payload, length - kCrcSize) != expected) {
    return DecodeResult::Crc;
  }
  if (frame.version != kVersion) {
    return DecodeResult::Version;
  }
  for (uint16_t i = 0; i < frame.length; ++i) {
    frame.body[i] = payload[kHeaderSize + i];
  }
  return DecodeResult::Ok;
}

FrameReader::Result FrameReader::push(uint8_t byte, Frame& frame) {
  if (byte != 0) {
    if (size_ >= sizeof(buffer_)) {
      overflow_ = true;
      return Result::Pending;
    }
    buffer_[size_++] = byte;
    return Result::Pending;
  }
  if (overflow_) {
    overflow_ = false;
    size_ = 0;
    lastError_ = DecodeResult::Overflow;
    return Result::Error;
  }
  if (size_ == 0) {
    return Result::Pending;
  }
  uint8_t payload[kMaxPayload];
  const size_t decoded = cobsDecode(buffer_, size_, payload, sizeof(payload));
  size_ = 0;
  if (decoded == 0) {
    lastError_ = DecodeResult::Cobs;
    return Result::Error;
  }
  lastError_ = decodePayload(payload, decoded, frame);
  return lastError_ == DecodeResult::Ok ? Result::Frame : Result::Error;
}

}
