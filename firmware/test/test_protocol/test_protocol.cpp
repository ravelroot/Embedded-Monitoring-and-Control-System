#include <unity.h>

#include <cstring>

#include <malha/cobs.hpp>
#include <malha/crc16.hpp>
#include <malha/protocol.hpp>

using namespace malha;
using namespace malha::proto;

void setUp() {}
void tearDown() {}

static void crcMatchesCcittFalseCheckValue() {
  const uint8_t data[] = {'1', '2', '3', '4', '5', '6', '7', '8', '9'};
  TEST_ASSERT_EQUAL_HEX16(0x29B1, crc16(data, sizeof(data)));
}

static void roundTrip(const uint8_t* data, size_t length) {
  uint8_t encoded[600];
  uint8_t decoded[600];
  const size_t encodedLength = cobsEncode(data, length, encoded, sizeof(encoded));
  TEST_ASSERT_TRUE(encodedLength > 0);
  for (size_t i = 0; i < encodedLength; ++i) {
    TEST_ASSERT_NOT_EQUAL(0, encoded[i]);
  }
  const size_t decodedLength = cobsDecode(encoded, encodedLength, decoded, sizeof(decoded));
  TEST_ASSERT_EQUAL_UINT32(length, decodedLength);
  TEST_ASSERT_EQUAL_MEMORY(data, decoded, length);
}

static void cobsRoundTripsZerosAndLongRuns() {
  const uint8_t zeros[] = {0, 0, 0, 1, 0};
  roundTrip(zeros, sizeof(zeros));
  uint8_t run[520];
  for (size_t i = 0; i < sizeof(run); ++i) {
    run[i] = static_cast<uint8_t>((i % 255) + 1);
  }
  roundTrip(run, 254);
  roundTrip(run, 255);
  roundTrip(run, sizeof(run));
  run[300] = 0;
  roundTrip(run, sizeof(run));
}

static void cobsRejectsTruncatedInput() {
  const uint8_t broken[] = {0x05, 0x11, 0x22};
  uint8_t output[8];
  TEST_ASSERT_EQUAL_UINT32(0, cobsDecode(broken, sizeof(broken), output, sizeof(output)));
}

static void frameRoundTripsThroughReader() {
  Frame frame;
  frame.type = MsgType::SetOutput;
  frame.seq = 513;
  frame.length = 3;
  frame.body[0] = 2;
  frame.body[1] = 0xEE;
  frame.body[2] = 0x02;
  uint8_t wire[kMaxWire];
  const size_t size = encodeFrame(frame, wire, sizeof(wire));
  TEST_ASSERT_TRUE(size > 0);
  TEST_ASSERT_EQUAL_UINT8(0, wire[size - 1]);
  FrameReader reader;
  Frame decoded;
  FrameReader::Result result = FrameReader::Result::Pending;
  for (size_t i = 0; i < size; ++i) {
    result = reader.push(wire[i], decoded);
  }
  TEST_ASSERT_EQUAL(FrameReader::Result::Frame, result);
  TEST_ASSERT_EQUAL_UINT8(static_cast<uint8_t>(MsgType::SetOutput), static_cast<uint8_t>(decoded.type));
  TEST_ASSERT_EQUAL_UINT16(513, decoded.seq);
  TEST_ASSERT_EQUAL_UINT16(3, decoded.length);
  TEST_ASSERT_EQUAL_MEMORY(frame.body, decoded.body, 3);
}

static void readerResynchronizesAfterGarbage() {
  Frame frame;
  frame.type = MsgType::Hello;
  frame.seq = 7;
  uint8_t wire[kMaxWire];
  const size_t size = encodeFrame(frame, wire, sizeof(wire));
  FrameReader reader;
  Frame decoded;
  const uint8_t garbage[] = {0x13, 0x37, 0x42, 0x00};
  int errors = 0;
  for (uint8_t byte : garbage) {
    if (reader.push(byte, decoded) == FrameReader::Result::Error) {
      ++errors;
    }
  }
  TEST_ASSERT_EQUAL_INT(1, errors);
  FrameReader::Result result = FrameReader::Result::Pending;
  for (size_t i = 0; i < size; ++i) {
    result = reader.push(wire[i], decoded);
  }
  TEST_ASSERT_EQUAL(FrameReader::Result::Frame, result);
  TEST_ASSERT_EQUAL_UINT16(7, decoded.seq);
}

static void readerDetectsCorruptedCrc() {
  Frame frame;
  frame.type = MsgType::Ping;
  frame.length = 4;
  uint8_t wire[kMaxWire];
  const size_t size = encodeFrame(frame, wire, sizeof(wire));
  wire[3] ^= 0x40;
  if (wire[3] == 0) {
    wire[3] = 0x40;
  }
  FrameReader reader;
  Frame decoded;
  FrameReader::Result result = FrameReader::Result::Pending;
  for (size_t i = 0; i < size; ++i) {
    result = reader.push(wire[i], decoded);
  }
  TEST_ASSERT_EQUAL(FrameReader::Result::Error, result);
}

static void readerReportsOverflow() {
  FrameReader reader;
  Frame decoded;
  for (size_t i = 0; i < kMaxWire + 20; ++i) {
    TEST_ASSERT_EQUAL(FrameReader::Result::Pending, reader.push(0x11, decoded));
  }
  TEST_ASSERT_EQUAL(FrameReader::Result::Error, reader.push(0, decoded));
  TEST_ASSERT_EQUAL(DecodeResult::Overflow, reader.lastError());
}

static void encoderRejectsOversizedBody() {
  Frame frame;
  frame.length = kMaxBody + 1;
  uint8_t wire[kMaxWire];
  TEST_ASSERT_EQUAL_UINT32(0, encodeFrame(frame, wire, sizeof(wire)));
}

int main(int, char**) {
  UNITY_BEGIN();
  RUN_TEST(crcMatchesCcittFalseCheckValue);
  RUN_TEST(cobsRoundTripsZerosAndLongRuns);
  RUN_TEST(cobsRejectsTruncatedInput);
  RUN_TEST(frameRoundTripsThroughReader);
  RUN_TEST(readerResynchronizesAfterGarbage);
  RUN_TEST(readerDetectsCorruptedCrc);
  RUN_TEST(readerReportsOverflow);
  RUN_TEST(encoderRejectsOversizedBody);
  return UNITY_END();
}
