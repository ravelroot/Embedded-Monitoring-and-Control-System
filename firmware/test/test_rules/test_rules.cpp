#include <unity.h>

#include <cmath>
#include <limits>

#include <malha/rules.hpp>
#include <malha/sensors.hpp>
#include <malha/settings.hpp>

using namespace malha;

void setUp() {}
void tearDown() {}

static Rule hotRule(uint16_t delayS) {
  Rule rule;
  rule.enabled = 1;
  rule.channel = Temperature;
  rule.comparison = Comparison::Above;
  rule.threshold = 30.0f;
  rule.hysteresis = 2.0f;
  rule.delayS = delayS;
  rule.output = Fan;
  rule.onValue = 1000;
  rule.offValue = 0;
  rule.severity = 2;
  return rule;
}

static size_t step(RuleEngine& engine, float temperature, uint32_t now, RuleTransition* out) {
  float values[kChannelCount] = {temperature, 50, 50, 5, 0};
  bool valid[kChannelCount] = {true, true, true, true, true};
  return engine.evaluate(values, valid, now, out, kRuleSlots);
}

static void activatesOnlyAfterDelay() {
  RuleEngine engine;
  TEST_ASSERT_TRUE(engine.set(0, hotRule(5)));
  RuleTransition out[kRuleSlots];
  TEST_ASSERT_EQUAL_UINT32(0, step(engine, 31, 0, out));
  TEST_ASSERT_EQUAL_UINT32(0, step(engine, 31, 4000, out));
  TEST_ASSERT_EQUAL_UINT32(1, step(engine, 31, 5000, out));
  TEST_ASSERT_TRUE(out[0].active);
  TEST_ASSERT_EQUAL_UINT8(1, engine.activeMask());
}

static void delayRestartsWhenConditionDrops() {
  RuleEngine engine;
  engine.set(0, hotRule(5));
  RuleTransition out[kRuleSlots];
  step(engine, 31, 0, out);
  step(engine, 29, 3000, out);
  TEST_ASSERT_EQUAL_UINT32(0, step(engine, 31, 6000, out));
  TEST_ASSERT_EQUAL_UINT32(0, step(engine, 31, 10000, out));
  TEST_ASSERT_EQUAL_UINT32(1, step(engine, 31, 11000, out));
}

static void hysteresisHoldsUntilBand() {
  RuleEngine engine;
  engine.set(0, hotRule(0));
  RuleTransition out[kRuleSlots];
  TEST_ASSERT_EQUAL_UINT32(1, step(engine, 31, 0, out));
  TEST_ASSERT_EQUAL_UINT32(0, step(engine, 29, 1000, out));
  TEST_ASSERT_EQUAL_UINT32(0, step(engine, 28.5f, 2000, out));
  TEST_ASSERT_EQUAL_UINT32(1, step(engine, 27.9f, 3000, out));
  TEST_ASSERT_FALSE(out[0].active);
}

static void belowComparisonWorks() {
  RuleEngine engine;
  Rule rule = hotRule(0);
  rule.comparison = Comparison::Below;
  rule.threshold = 10;
  rule.hysteresis = 1;
  engine.set(1, rule);
  RuleTransition out[kRuleSlots];
  TEST_ASSERT_EQUAL_UINT32(1, step(engine, 9, 0, out));
  TEST_ASSERT_EQUAL_UINT8(1, out[0].slot);
  TEST_ASSERT_EQUAL_UINT32(0, step(engine, 10.5f, 1000, out));
  TEST_ASSERT_EQUAL_UINT32(1, step(engine, 11.5f, 2000, out));
}

static void invalidRulesAreRejected() {
  RuleEngine engine;
  Rule rule = hotRule(0);
  rule.channel = 9;
  TEST_ASSERT_FALSE(engine.set(0, rule));
  rule = hotRule(0);
  rule.onValue = 2000;
  TEST_ASSERT_FALSE(engine.set(0, rule));
  rule = hotRule(0);
  rule.output = Relay1;
  rule.onValue = 2;
  TEST_ASSERT_FALSE(engine.set(0, rule));
  rule = hotRule(0);
  rule.hysteresis = -1;
  TEST_ASSERT_FALSE(engine.set(0, rule));
  rule = hotRule(0);
  rule.threshold = std::numeric_limits<float>::quiet_NaN();
  TEST_ASSERT_FALSE(engine.set(0, rule));
  rule = hotRule(0);
  rule.output = kNoOutput;
  rule.severity = 0;
  TEST_ASSERT_FALSE(engine.set(0, rule));
  TEST_ASSERT_FALSE(engine.set(kRuleSlots, hotRule(0)));
}

static void invalidSensorDoesNotTrigger() {
  RuleEngine engine;
  engine.set(0, hotRule(0));
  float values[kChannelCount] = {std::numeric_limits<float>::quiet_NaN(), 0, 0, 0, 0};
  bool valid[kChannelCount] = {false, true, true, true, true};
  RuleTransition out[kRuleSlots];
  TEST_ASSERT_EQUAL_UINT32(0, engine.evaluate(values, valid, 0, out, kRuleSlots));
}

static void ntcConversionMatchesReference() {
  TEST_ASSERT_FLOAT_WITHIN(0.05f, 25.0f, ntcCelsius(2048, 4095));
  TEST_ASSERT_TRUE(ntcCelsius(1000, 4095) > 25.0f);
  TEST_ASSERT_TRUE(std::isnan(ntcCelsius(0, 4095)));
  TEST_ASSERT_TRUE(std::isnan(ntcCelsius(4095, 4095)));
}

static void helpersConvertUnits() {
  TEST_ASSERT_FLOAT_WITHIN(0.01f, 50.0f, rawPercent(2048, 4096));
  TEST_ASSERT_FLOAT_WITHIN(0.01f, 100.0f, rawPercent(5000, 4095));
  TEST_ASSERT_FLOAT_WITHIN(0.001f, 4.9f, dividerVolts(2450, 2.0f));
  Calibration calibration;
  calibration.gain = 2.0f;
  calibration.offset = -1.0f;
  TEST_ASSERT_FLOAT_WITHIN(0.001f, 9.0f, applyCalibration(5.0f, calibration));
}

static void emaSmoothsAndResetsOnNaN() {
  Ema ema;
  ema.configure(50);
  TEST_ASSERT_FLOAT_WITHIN(0.001f, 10.0f, ema.update(10));
  TEST_ASSERT_FLOAT_WITHIN(0.001f, 15.0f, ema.update(20));
  TEST_ASSERT_TRUE(std::isnan(ema.update(std::numeric_limits<float>::quiet_NaN())));
  TEST_ASSERT_FLOAT_WITHIN(0.001f, 40.0f, ema.update(40));
}

static void settingsRoundTripAndRejectCorruption() {
  Config config;
  config.sampleIntervalMs = 500;
  config.calibration[Temperature].offset = -0.5f;
  Rule rules[kRuleSlots];
  rules[3] = hotRule(10);
  uint8_t buffer[kSettingsSize];
  const size_t length = serializeSettings(config, rules, buffer, sizeof(buffer));
  TEST_ASSERT_EQUAL_UINT32(kSettingsSize, length);
  Config loaded;
  Rule loadedRules[kRuleSlots];
  TEST_ASSERT_TRUE(deserializeSettings(buffer, length, loaded, loadedRules));
  TEST_ASSERT_EQUAL_UINT16(500, loaded.sampleIntervalMs);
  TEST_ASSERT_FLOAT_WITHIN(0.0001f, -0.5f, loaded.calibration[Temperature].offset);
  TEST_ASSERT_EQUAL_UINT16(10, loadedRules[3].delayS);
  buffer[20] ^= 0x01;
  TEST_ASSERT_FALSE(deserializeSettings(buffer, length, loaded, loadedRules));
}

int main(int, char**) {
  UNITY_BEGIN();
  RUN_TEST(activatesOnlyAfterDelay);
  RUN_TEST(delayRestartsWhenConditionDrops);
  RUN_TEST(hysteresisHoldsUntilBand);
  RUN_TEST(belowComparisonWorks);
  RUN_TEST(invalidRulesAreRejected);
  RUN_TEST(invalidSensorDoesNotTrigger);
  RUN_TEST(ntcConversionMatchesReference);
  RUN_TEST(helpersConvertUnits);
  RUN_TEST(emaSmoothsAndResetsOnNaN);
  RUN_TEST(settingsRoundTripAndRejectCorruption);
  return UNITY_END();
}
