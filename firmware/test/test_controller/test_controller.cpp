#include <unity.h>

#include <cmath>
#include <cstring>
#include <limits>
#include <vector>

#include <malha/bytes.hpp>
#include <malha/controller.hpp>
#include <malha/settings.hpp>

using namespace malha;
using namespace malha::proto;

class FakeHal final : public Hal {
 public:
  uint32_t now = 0;
  float inputs[kChannelCount] = {25, 50, 40, 5, 0};
  uint16_t written[kOutputCount] = {};
  std::vector<uint8_t> sent;
  std::vector<uint8_t> storage;
  bool rebooted = false;
  bool failStorage = false;

  uint32_t millis() override { return now; }
  float readChannel(uint8_t channel) override { return inputs[channel]; }
  void writeOutput(uint8_t output, uint16_t value) override { written[output] = value; }
  void send(const uint8_t* data, size_t length) override { sent.insert(sent.end(), data, data + length); }
  size_t loadSettings(uint8_t* buffer, size_t capacity) override {
    if (storage.empty() || storage.size() > capacity) {
      return 0;
    }
    std::memcpy(buffer, storage.data(), storage.size());
    return storage.size();
  }
  bool storeSettings(const uint8_t* data, size_t length) override {
    if (failStorage) {
      return false;
    }
    storage.assign(data, data + length);
    return true;
  }
  bool eraseSettings() override {
    storage.clear();
    return true;
  }
  void reboot() override { rebooted = true; }
  uint64_t deviceId() override { return 0xA1B2C3D4E5F6ull; }
  uint8_t bootReason() override { return 1; }
  uint8_t hardwareModel() override { return 9; }
};

static std::vector<Frame> drain(FakeHal& hal) {
  std::vector<Frame> frames;
  FrameReader reader;
  Frame frame;
  for (uint8_t byte : hal.sent) {
    if (reader.push(byte, frame) == FrameReader::Result::Frame) {
      frames.push_back(frame);
    }
  }
  hal.sent.clear();
  return frames;
}

static void sendFrame(Controller& controller, MsgType type, uint16_t seq, const uint8_t* body, size_t length) {
  Frame frame;
  frame.type = type;
  frame.seq = seq;
  frame.length = static_cast<uint16_t>(length);
  if (length > 0) {
    std::memcpy(frame.body, body, length);
  }
  uint8_t wire[kMaxWire];
  const size_t size = encodeFrame(frame, wire, sizeof(wire));
  for (size_t i = 0; i < size; ++i) {
    controller.onByte(wire[i]);
  }
}

static const Frame* find(const std::vector<Frame>& frames, MsgType type) {
  for (const Frame& frame : frames) {
    if (frame.type == type) {
      return &frame;
    }
  }
  return nullptr;
}

static Status ackStatus(const std::vector<Frame>& frames, uint16_t seq) {
  for (const Frame& frame : frames) {
    if (frame.type == MsgType::Ack && frame.seq == seq) {
      return static_cast<Status>(frame.body[1]);
    }
  }
  TEST_FAIL_MESSAGE("ack ausente");
  return Status::UnknownType;
}

void setUp() {}
void tearDown() {}

static void bootAnnouncesAndStreamsTelemetry() {
  FakeHal hal;
  Controller controller(hal);
  controller.begin();
  std::vector<Frame> frames = drain(hal);
  const Frame* boot = find(frames, MsgType::Event);
  TEST_ASSERT_NOT_NULL(boot);
  TEST_ASSERT_EQUAL_UINT8(static_cast<uint8_t>(EventCode::Boot), boot->body[0]);
  TEST_ASSERT_NOT_NULL(find(frames, MsgType::Telemetry));
  hal.now = 1000;
  controller.tick();
  frames = drain(hal);
  const Frame* telemetry = find(frames, MsgType::Telemetry);
  TEST_ASSERT_NOT_NULL(telemetry);
  ByteReader reader(telemetry->body, telemetry->length);
  TEST_ASSERT_EQUAL_UINT32(1000, reader.u32());
  reader.u8();
  TEST_ASSERT_EQUAL_UINT8(kChannelCount, reader.u8());
  TEST_ASSERT_FLOAT_WITHIN(0.01f, 25.0f, reader.f32());
}

static void helloReturnsDeviceInfo() {
  FakeHal hal;
  Controller controller(hal);
  controller.begin();
  drain(hal);
  sendFrame(controller, MsgType::Hello, 42, nullptr, 0);
  const std::vector<Frame> frames = drain(hal);
  const Frame* info = find(frames, MsgType::Info);
  TEST_ASSERT_NOT_NULL(info);
  TEST_ASSERT_EQUAL_UINT16(42, info->seq);
  ByteReader reader(info->body, info->length);
  TEST_ASSERT_EQUAL_UINT8(kVersion, reader.u8());
  TEST_ASSERT_EQUAL_UINT8(kFirmwareMajor, reader.u8());
  reader.u8();
  reader.u8();
  TEST_ASSERT_TRUE(reader.u64() == 0xA1B2C3D4E5F6ull);
  TEST_ASSERT_TRUE(controller.linkUp());
}

static void setOutputValidatesAndApplies() {
  FakeHal hal;
  Controller controller(hal);
  controller.begin();
  drain(hal);
  const uint8_t fan[] = {Fan, 0xEE, 0x02};
  sendFrame(controller, MsgType::SetOutput, 5, fan, sizeof(fan));
  std::vector<Frame> frames = drain(hal);
  TEST_ASSERT_EQUAL(Status::Ok, ackStatus(frames, 5));
  TEST_ASSERT_EQUAL_UINT16(750, hal.written[Fan]);
  const uint8_t relay[] = {Relay1, 0x02, 0x00};
  sendFrame(controller, MsgType::SetOutput, 6, relay, sizeof(relay));
  frames = drain(hal);
  TEST_ASSERT_EQUAL(Status::InvalidArgument, ackStatus(frames, 6));
  TEST_ASSERT_EQUAL_UINT16(0, hal.written[Relay1]);
  sendFrame(controller, MsgType::SetOutput, 7, relay, 2);
  frames = drain(hal);
  TEST_ASSERT_EQUAL(Status::BadLength, ackStatus(frames, 7));
  sendFrame(controller, static_cast<MsgType>(0x5A), 8, nullptr, 0);
  frames = drain(hal);
  TEST_ASSERT_EQUAL(Status::UnknownType, ackStatus(frames, 8));
}

static void ruleDrivesOutputAndEmitsEvents() {
  FakeHal hal;
  Controller controller(hal);
  controller.begin();
  drain(hal);
  uint8_t body[1 + kRuleWireSize];
  ByteWriter writer(body, sizeof(body));
  writer.u8(0);
  Rule rule;
  rule.enabled = 1;
  rule.channel = Temperature;
  rule.threshold = 30;
  rule.hysteresis = 1;
  rule.output = Relay2;
  rule.onValue = 1;
  rule.offValue = 0;
  rule.severity = 3;
  writeRule(writer, rule);
  sendFrame(controller, MsgType::SetRule, 9, body, writer.size());
  TEST_ASSERT_EQUAL(Status::Ok, ackStatus(drain(hal), 9));
  TEST_ASSERT_TRUE(controller.dirty());
  hal.inputs[Temperature] = 35;
  for (int i = 1; i <= 10; ++i) {
    hal.now = static_cast<uint32_t>(i) * 1000;
    sendFrame(controller, MsgType::Ping, static_cast<uint16_t>(100 + i), reinterpret_cast<const uint8_t*>("ping"), 4);
    controller.tick();
  }
  TEST_ASSERT_EQUAL_UINT16(1, hal.written[Relay2]);
  std::vector<Frame> frames = drain(hal);
  bool sawRuleOn = false;
  for (const Frame& frame : frames) {
    if (frame.type == MsgType::Event && frame.body[0] == static_cast<uint8_t>(EventCode::RuleOn)) {
      sawRuleOn = true;
      TEST_ASSERT_EQUAL_UINT8(3, frame.body[1]);
    }
  }
  TEST_ASSERT_TRUE(sawRuleOn);
  const uint8_t clear[] = {0};
  sendFrame(controller, MsgType::ClearRule, 10, clear, 1);
  TEST_ASSERT_EQUAL(Status::Ok, ackStatus(drain(hal), 10));
  TEST_ASSERT_EQUAL_UINT16(0, hal.written[Relay2]);
}

static void linkLossForcesManualOutputsToSafeState() {
  FakeHal hal;
  Controller controller(hal);
  controller.begin();
  const uint8_t relay[] = {Relay1, 0x01, 0x00};
  sendFrame(controller, MsgType::SetOutput, 1, relay, sizeof(relay));
  TEST_ASSERT_EQUAL_UINT16(1, hal.written[Relay1]);
  drain(hal);
  hal.now = 10000;
  controller.tick();
  TEST_ASSERT_EQUAL_UINT16(1, hal.written[Relay1]);
  hal.now = 10001;
  controller.tick();
  TEST_ASSERT_FALSE(controller.linkUp());
  TEST_ASSERT_EQUAL_UINT16(0, hal.written[Relay1]);
  std::vector<Frame> frames = drain(hal);
  bool sawLinkLost = false;
  for (const Frame& frame : frames) {
    if (frame.type == MsgType::Event && frame.body[0] == static_cast<uint8_t>(EventCode::LinkLost)) {
      sawLinkLost = true;
    }
  }
  TEST_ASSERT_TRUE(sawLinkLost);
  sendFrame(controller, MsgType::Hello, 2, nullptr, 0);
  frames = drain(hal);
  bool sawRestored = false;
  for (const Frame& frame : frames) {
    if (frame.type == MsgType::Event && frame.body[0] == static_cast<uint8_t>(EventCode::LinkRestored)) {
      sawRestored = true;
    }
  }
  TEST_ASSERT_TRUE(sawRestored);
}

static void settingsPersistAcrossReboot() {
  FakeHal hal;
  {
    Controller controller(hal);
    controller.begin();
    uint8_t calibration[9];
    ByteWriter writer(calibration, sizeof(calibration));
    writer.u8(Temperature);
    writer.f32(1.0f);
    writer.f32(-2.0f);
    sendFrame(controller, MsgType::SetCalibration, 3, calibration, writer.size());
    sendFrame(controller, MsgType::Save, 4, nullptr, 0);
    std::vector<Frame> frames = drain(hal);
    TEST_ASSERT_EQUAL(Status::Ok, ackStatus(frames, 3));
    TEST_ASSERT_EQUAL(Status::Ok, ackStatus(frames, 4));
    TEST_ASSERT_FALSE(controller.dirty());
  }
  TEST_ASSERT_EQUAL_UINT32(kSettingsSize, hal.storage.size());
  Controller restored(hal);
  restored.begin();
  TEST_ASSERT_FLOAT_WITHIN(0.0001f, -2.0f, restored.config().calibration[Temperature].offset);
  TEST_ASSERT_FLOAT_WITHIN(0.01f, 23.0f, restored.value(Temperature));
}

static void storageFailureIsReported() {
  FakeHal hal;
  hal.failStorage = true;
  Controller controller(hal);
  controller.begin();
  drain(hal);
  sendFrame(controller, MsgType::Save, 1, nullptr, 0);
  TEST_ASSERT_EQUAL(Status::StorageError, ackStatus(drain(hal), 1));
}

static void factoryResetRestoresDefaults() {
  FakeHal hal;
  Controller controller(hal);
  controller.begin();
  uint8_t config[kConfigWireSize];
  ByteWriter writer(config, sizeof(config));
  Config custom;
  custom.sampleIntervalMs = 250;
  writeConfig(writer, custom);
  sendFrame(controller, MsgType::SetConfig, 1, config, writer.size());
  sendFrame(controller, MsgType::Save, 2, nullptr, 0);
  TEST_ASSERT_EQUAL_UINT16(250, controller.config().sampleIntervalMs);
  sendFrame(controller, MsgType::FactoryReset, 3, nullptr, 0);
  TEST_ASSERT_EQUAL(Status::Ok, ackStatus(drain(hal), 3));
  TEST_ASSERT_EQUAL_UINT16(1000, controller.config().sampleIntervalMs);
  TEST_ASSERT_TRUE(hal.storage.empty());
}

static void invalidConfigIsRejected() {
  FakeHal hal;
  Controller controller(hal);
  controller.begin();
  drain(hal);
  uint8_t config[kConfigWireSize];
  ByteWriter writer(config, sizeof(config));
  Config custom;
  custom.sampleIntervalMs = 10;
  writeConfig(writer, custom);
  sendFrame(controller, MsgType::SetConfig, 1, config, writer.size());
  TEST_ASSERT_EQUAL(Status::InvalidArgument, ackStatus(drain(hal), 1));
  TEST_ASSERT_EQUAL_UINT16(1000, controller.config().sampleIntervalMs);
}

static void sensorFaultIsReportedOnce() {
  FakeHal hal;
  Controller controller(hal);
  controller.begin();
  drain(hal);
  hal.inputs[Temperature] = std::numeric_limits<float>::quiet_NaN();
  int faults = 0;
  for (int i = 1; i <= 3; ++i) {
    hal.now = static_cast<uint32_t>(i) * 1000;
    controller.tick();
    for (const Frame& frame : drain(hal)) {
      if (frame.type == MsgType::Event && frame.body[0] == static_cast<uint8_t>(EventCode::SensorFault)) {
        ++faults;
      }
    }
  }
  TEST_ASSERT_EQUAL_INT(1, faults);
  TEST_ASSERT_TRUE(std::isnan(controller.value(Temperature)));
}

static void rebootIsAcknowledgedFirst() {
  FakeHal hal;
  Controller controller(hal);
  controller.begin();
  drain(hal);
  sendFrame(controller, MsgType::Reboot, 77, nullptr, 0);
  TEST_ASSERT_EQUAL(Status::Ok, ackStatus(drain(hal), 77));
  TEST_ASSERT_TRUE(hal.rebooted);
}

int main(int, char**) {
  UNITY_BEGIN();
  RUN_TEST(bootAnnouncesAndStreamsTelemetry);
  RUN_TEST(helloReturnsDeviceInfo);
  RUN_TEST(setOutputValidatesAndApplies);
  RUN_TEST(ruleDrivesOutputAndEmitsEvents);
  RUN_TEST(linkLossForcesManualOutputsToSafeState);
  RUN_TEST(settingsPersistAcrossReboot);
  RUN_TEST(storageFailureIsReported);
  RUN_TEST(factoryResetRestoresDefaults);
  RUN_TEST(invalidConfigIsRejected);
  RUN_TEST(sensorFaultIsReportedOnce);
  RUN_TEST(rebootIsAcknowledgedFirst);
  return UNITY_END();
}
