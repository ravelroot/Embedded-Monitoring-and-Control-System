#include <unity.h>

#include <fstream>
#include <regex>
#include <string>
#include <vector>

#include <malha/cobs.hpp>
#include <malha/protocol.hpp>

using namespace malha;
using namespace malha::proto;

namespace {

struct Vector {
  std::string name;
  int type = 0;
  int seq = 0;
  std::vector<uint8_t> body;
  std::vector<uint8_t> wire;
  std::string error;
};

std::vector<uint8_t> fromHex(const std::string& hex) {
  std::vector<uint8_t> bytes;
  for (size_t i = 0; i + 1 < hex.size(); i += 2) {
    bytes.push_back(static_cast<uint8_t>(std::stoi(hex.substr(i, 2), nullptr, 16)));
  }
  return bytes;
}

std::string field(const std::string& line, const char* key) {
  const std::regex pattern(std::string("\"") + key + "\":\"?([^\",}]*)\"?");
  std::smatch match;
  return std::regex_search(line, match, pattern) ? match[1].str() : std::string();
}

std::vector<Vector> load() {
  std::vector<Vector> vectors;
  for (const char* path : {"../protocol/vectors.json", "protocol/vectors.json"}) {
    std::ifstream file(path);
    if (!file) {
      continue;
    }
    std::string line;
    while (std::getline(file, line)) {
      if (line.find("\"wire\"") == std::string::npos) {
        continue;
      }
      Vector vector;
      vector.name = field(line, "name");
      vector.wire = fromHex(field(line, "wire"));
      vector.error = field(line, "error");
      if (vector.error.empty()) {
        vector.type = std::stoi(field(line, "type"));
        vector.seq = std::stoi(field(line, "seq"));
        vector.body = fromHex(field(line, "body"));
      }
      vectors.push_back(vector);
    }
    break;
  }
  return vectors;
}

const char* errorName(DecodeResult result) {
  switch (result) {
    case DecodeResult::Cobs:
      return "cobs";
    case DecodeResult::TooShort:
      return "short";
    case DecodeResult::Length:
      return "length";
    case DecodeResult::Crc:
      return "crc";
    case DecodeResult::Version:
      return "version";
    default:
      return "other";
  }
}

}

void setUp() {}
void tearDown() {}

static void validVectorsMatchByteForByte() {
  const std::vector<Vector> vectors = load();
  TEST_ASSERT_TRUE_MESSAGE(vectors.size() >= 10, "protocol/vectors.json nao encontrado");
  int checked = 0;
  for (const Vector& vector : vectors) {
    if (!vector.error.empty()) {
      continue;
    }
    Frame frame;
    frame.type = static_cast<MsgType>(vector.type);
    frame.seq = static_cast<uint16_t>(vector.seq);
    frame.length = static_cast<uint16_t>(vector.body.size());
    for (size_t i = 0; i < vector.body.size(); ++i) {
      frame.body[i] = vector.body[i];
    }
    uint8_t wire[kMaxWire];
    const size_t size = encodeFrame(frame, wire, sizeof(wire));
    TEST_ASSERT_EQUAL_UINT32_MESSAGE(vector.wire.size(), size, vector.name.c_str());
    TEST_ASSERT_EQUAL_MEMORY_MESSAGE(vector.wire.data(), wire, size, vector.name.c_str());
    FrameReader reader;
    Frame decoded;
    FrameReader::Result result = FrameReader::Result::Pending;
    for (uint8_t byte : vector.wire) {
      result = reader.push(byte, decoded);
    }
    TEST_ASSERT_EQUAL_MESSAGE(FrameReader::Result::Frame, result, vector.name.c_str());
    TEST_ASSERT_EQUAL_UINT16(vector.seq, decoded.seq);
    ++checked;
  }
  TEST_ASSERT_TRUE(checked >= 10);
}

static void invalidVectorsFailWithExpectedReason() {
  const std::vector<Vector> vectors = load();
  int checked = 0;
  for (const Vector& vector : vectors) {
    if (vector.error.empty()) {
      continue;
    }
    FrameReader reader;
    Frame decoded;
    FrameReader::Result result = FrameReader::Result::Pending;
    for (uint8_t byte : vector.wire) {
      result = reader.push(byte, decoded);
    }
    TEST_ASSERT_EQUAL_MESSAGE(FrameReader::Result::Error, result, vector.name.c_str());
    TEST_ASSERT_EQUAL_STRING_MESSAGE(vector.error.c_str(), errorName(reader.lastError()), vector.name.c_str());
    ++checked;
  }
  TEST_ASSERT_TRUE(checked >= 4);
}

int main(int, char**) {
  UNITY_BEGIN();
  RUN_TEST(validVectorsMatchByteForByte);
  RUN_TEST(invalidVectorsFailWithExpectedReason);
  return UNITY_END();
}
