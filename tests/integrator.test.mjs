import assert from "node:assert/strict";
import test from "node:test";
import {
  GSI_CONFIG_CONTENT,
  GSI_CONFIG_PROFILE,
  isPerformanceGsiConfig,
} from "../companion/integrator.mjs";

test("GSI performans profili paket sıklığını ve gereksiz alanları azaltır", () => {
  assert.equal(GSI_CONFIG_PROFILE, "performance-v2");
  assert.equal(isPerformanceGsiConfig(GSI_CONFIG_CONTENT), true);
  assert.match(GSI_CONFIG_CONTENT, /"throttle"\s+"0\.1"/);
  assert.match(GSI_CONFIG_CONTENT, /"buffer"\s+"0\.1"/);
  assert.match(GSI_CONFIG_CONTENT, /"heartbeat"\s+"2\.0"/);
  assert.doesNotMatch(GSI_CONFIG_CONTENT, /"allplayers_position"/);
  assert.doesNotMatch(GSI_CONFIG_CONTENT, /"allplayers_match_stats"/);
  assert.equal(isPerformanceGsiConfig(GSI_CONFIG_CONTENT.replace('"throttle" "0.1"', '"throttle" "0.05"')), false);
});
