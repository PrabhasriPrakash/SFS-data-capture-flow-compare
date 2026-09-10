const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  parseFlowXml,
  diffFlowSnapshots,
  formatDiffMarkdown,
} = require("../out/flowDiff");
const { verifyFlowFile, FlowVerificationError } = require("../out/verifyFlow");
const { parseSfJson } = require("../out/sfJson");

function flowXml(body) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<Flow xmlns="http://soap.sforce.com/2006/04/metadata">
  <processType>DataCaptureFlow</processType>
  <status>Active</status>
  ${body}
</Flow>`;
}

test("assignment removed and connector change are detailed", () => {
  const left = flowXml(`
  <assignments>
    <name>Assequip</name>
    <label>Assequip</label>
    <assignmentItems>
      <assignToReference>JobFormRecord.A__c</assignToReference>
      <operator>Assign</operator>
      <value><stringValue>Yes</stringValue></value>
    </assignmentItems>
    <assignmentItems>
      <assignToReference>JobFormRecord.B__c</assignToReference>
      <operator>Assign</operator>
      <value><elementReference>X</elementReference></value>
    </assignmentItems>
    <connector><targetReference>IssueResolved</targetReference></connector>
  </assignments>`);

  const right = flowXml(`
  <assignments>
    <name>Assequip</name>
    <label>Assequip</label>
    <assignmentItems>
      <assignToReference>JobFormRecord.A__c</assignToReference>
      <operator>Assign</operator>
      <value><stringValue>Yes</stringValue></value>
    </assignmentItems>
    <connector><targetReference>Next_Step</targetReference></connector>
  </assignments>`);

  const diff = diffFlowSnapshots(parseFlowXml(left), parseFlowXml(right));
  const mod = diff.changes.find((c) => c.name === "Assequip");
  assert.equal(mod.change, "modified");
  assert.ok(
    mod.details.some((d) => d.includes("Field assignment removed") && d.includes("B__c"))
  );
  assert.ok(mod.details.some((d) => d.includes("Next connector changed")));
});

test("assignment reorder-only is not a change; add/remove still are", () => {
  const left = flowXml(`
  <assignments>
    <name>Assequip</name>
    <label>Assequip</label>
    <assignmentItems>
      <assignToReference>JobFormRecord.A__c</assignToReference>
      <operator>Assign</operator>
      <value><stringValue>Yes</stringValue></value>
    </assignmentItems>
    <assignmentItems>
      <assignToReference>JobFormRecord.B__c</assignToReference>
      <operator>Assign</operator>
      <value><stringValue>No</stringValue></value>
    </assignmentItems>
  </assignments>`);
  const reordered = flowXml(`
  <assignments>
    <name>Assequip</name>
    <label>Assequip</label>
    <assignmentItems>
      <assignToReference>JobFormRecord.B__c</assignToReference>
      <operator>Assign</operator>
      <value><stringValue>No</stringValue></value>
    </assignmentItems>
    <assignmentItems>
      <assignToReference>JobFormRecord.A__c</assignToReference>
      <operator>Assign</operator>
      <value><stringValue>Yes</stringValue></value>
    </assignmentItems>
  </assignments>`);
  const withExtra = flowXml(`
  <assignments>
    <name>Assequip</name>
    <label>Assequip</label>
    <assignmentItems>
      <assignToReference>JobFormRecord.B__c</assignToReference>
      <operator>Assign</operator>
      <value><stringValue>No</stringValue></value>
    </assignmentItems>
    <assignmentItems>
      <assignToReference>JobFormRecord.A__c</assignToReference>
      <operator>Assign</operator>
      <value><stringValue>Yes</stringValue></value>
    </assignmentItems>
    <assignmentItems>
      <assignToReference>JobFormRecord.C__c</assignToReference>
      <operator>Assign</operator>
      <value><stringValue>Extra</stringValue></value>
    </assignmentItems>
  </assignments>`);

  const reorderDiff = diffFlowSnapshots(
    parseFlowXml(left),
    parseFlowXml(reordered)
  );
  assert.equal(
    reorderDiff.changes.filter((c) => c.name === "Assequip").length,
    0,
    "reorder-only assignments must not appear as modified"
  );

  const addDiff = diffFlowSnapshots(parseFlowXml(left), parseFlowXml(withExtra));
  const mod = addDiff.changes.find((c) => c.name === "Assequip");
  assert.equal(mod.change, "modified");
  assert.ok(mod.details.some((d) => d.includes("added") && d.includes("C__c")));
  assert.ok(!mod.details.some((d) => /\[0\]|\[1\]/.test(d)));
});

test("assignment retarget same field+value is one Updated row", () => {
  const left = flowXml(`
  <assignments>
    <name>Update_AMR_in_new_meter</name>
    <label>Update AMR in new meter</label>
    <assignmentItems>
      <assignToReference>JobFormRecord.SM_UpdatedAMIAMRSerialNumber__c</assignToReference>
      <operator>Assign</operator>
      <value><elementReference>NewAMISerialNumber.value</elementReference></value>
    </assignmentItems>
  </assignments>`);
  const right = flowXml(`
  <assignments>
    <name>Update_AMR_in_new_meter</name>
    <label>Update AMR in new meter</label>
    <assignmentItems>
      <assignToReference>getNewMeter.SM_UpdatedAMIAMRSerialNumber__c</assignToReference>
      <operator>Assign</operator>
      <value><elementReference>NewAMISerialNumber.value</elementReference></value>
    </assignmentItems>
  </assignments>`);

  const diff = diffFlowSnapshots(parseFlowXml(left), parseFlowXml(right));
  const mod = diff.changes.find((c) => c.name === "Update_AMR_in_new_meter");
  assert.ok(mod);
  assert.equal(mod.change, "modified");
  assert.ok(
    mod.details.some(
      (d) =>
        d.includes("Field assignment retargeted") &&
        d.includes("JobFormRecord.SM_UpdatedAMIAMRSerialNumber__c") &&
        d.includes("getNewMeter.SM_UpdatedAMIAMRSerialNumber__c")
    )
  );
  assert.ok(!mod.details.some((d) => d.includes("Field assignment removed")));
  assert.ok(!mod.details.some((d) => d.includes("Field assignment added")));
  assert.equal(
    mod.properties.filter((p) => p.path.includes("assignmentItems")).length,
    1
  );
  assert.ok(
    mod.properties.some(
      (p) =>
        p.path.includes("→") &&
        p.path.endsWith(".assignToReference") &&
        p.left.includes("JobFormRecord") &&
        p.right.includes("getNewMeter")
    )
  );
});

test("assignment retarget is not used when field leaf differs", () => {
  const left = flowXml(`
  <assignments>
    <name>A1</name>
    <label>A</label>
    <assignmentItems>
      <assignToReference>JobFormRecord.A__c</assignToReference>
      <operator>Assign</operator>
      <value><stringValue>1</stringValue></value>
    </assignmentItems>
  </assignments>`);
  const right = flowXml(`
  <assignments>
    <name>A1</name>
    <label>A</label>
    <assignmentItems>
      <assignToReference>JobFormRecord.B__c</assignToReference>
      <operator>Assign</operator>
      <value><stringValue>1</stringValue></value>
    </assignmentItems>
  </assignments>`);

  const diff = diffFlowSnapshots(parseFlowXml(left), parseFlowXml(right));
  const mod = diff.changes.find((c) => c.name === "A1");
  assert.ok(mod);
  assert.ok(mod.details.some((d) => d.includes("Field assignment removed")));
  assert.ok(mod.details.some((d) => d.includes("Field assignment added")));
  assert.ok(!mod.details.some((d) => d.includes("retargeted")));
});

test("ambiguous Status retargets resolve by variable prefix relatedness", () => {
  const left = flowXml(`
  <assignments>
    <name>Update_JF_SA_WS_WO</name>
    <label>Update JF/SA/WS/WO</label>
    <assignmentItems>
      <assignToReference>GetSAId.Status</assignToReference>
      <operator>Assign</operator>
      <value><stringValue>Completed</stringValue></value>
    </assignmentItems>
    <assignmentItems>
      <assignToReference>getWorkStepId.Status</assignToReference>
      <operator>Assign</operator>
      <value><stringValue>Completed</stringValue></value>
    </assignmentItems>
  </assignments>`);
  const right = flowXml(`
  <assignments>
    <name>Update_JF_SA_WS_WO</name>
    <label>Update JF/SA/WS/WO</label>
    <assignmentItems>
      <assignToReference>SARecord.Id</assignToReference>
      <operator>Assign</operator>
      <value><elementReference>GetSAId.Id</elementReference></value>
    </assignmentItems>
    <assignmentItems>
      <assignToReference>SARecord.Status</assignToReference>
      <operator>Assign</operator>
      <value><stringValue>Completed</stringValue></value>
    </assignmentItems>
    <assignmentItems>
      <assignToReference>WSRecord.Id</assignToReference>
      <operator>Assign</operator>
      <value><elementReference>getWorkStepId.Id</elementReference></value>
    </assignmentItems>
    <assignmentItems>
      <assignToReference>WSRecord.Status</assignToReference>
      <operator>Assign</operator>
      <value><stringValue>Completed</stringValue></value>
    </assignmentItems>
  </assignments>`);

  const diff = diffFlowSnapshots(parseFlowXml(left), parseFlowXml(right));
  const mod = diff.changes.find((c) => c.name === "Update_JF_SA_WS_WO");
  assert.ok(mod);
  assert.ok(
    mod.details.some(
      (d) =>
        d.includes("retargeted") &&
        d.includes("GetSAId.Status") &&
        d.includes("SARecord.Status")
    )
  );
  assert.ok(
    mod.details.some(
      (d) =>
        d.includes("retargeted") &&
        d.includes("getWorkStepId.Status") &&
        d.includes("WSRecord.Status")
    )
  );
  assert.ok(
    mod.details.some(
      (d) => d.includes("Field assignment added") && d.includes("SARecord.Id")
    )
  );
  assert.ok(
    mod.details.some(
      (d) => d.includes("Field assignment added") && d.includes("WSRecord.Id")
    )
  );
  assert.ok(!mod.details.some((d) => d.includes("Field assignment removed")));
});

test("ambiguous Status retargets stay remove+add when prefixes unrelated", () => {
  const left = flowXml(`
  <assignments>
    <name>A1</name>
    <label>A</label>
    <assignmentItems>
      <assignToReference>Alpha.Status</assignToReference>
      <operator>Assign</operator>
      <value><stringValue>Completed</stringValue></value>
    </assignmentItems>
    <assignmentItems>
      <assignToReference>Beta.Status</assignToReference>
      <operator>Assign</operator>
      <value><stringValue>Completed</stringValue></value>
    </assignmentItems>
  </assignments>`);
  const right = flowXml(`
  <assignments>
    <name>A1</name>
    <label>A</label>
    <assignmentItems>
      <assignToReference>Gamma.Status</assignToReference>
      <operator>Assign</operator>
      <value><stringValue>Completed</stringValue></value>
    </assignmentItems>
    <assignmentItems>
      <assignToReference>Delta.Status</assignToReference>
      <operator>Assign</operator>
      <value><stringValue>Completed</stringValue></value>
    </assignmentItems>
  </assignments>`);

  const diff = diffFlowSnapshots(parseFlowXml(left), parseFlowXml(right));
  const mod = diff.changes.find((c) => c.name === "A1");
  assert.ok(mod);
  assert.ok(!mod.details.some((d) => d.includes("retargeted")));
  assert.equal(
    mod.details.filter((d) => d.includes("Field assignment removed")).length,
    2
  );
  assert.equal(
    mod.details.filter((d) => d.includes("Field assignment added")).length,
    2
  );
});

test("API rename is reported as modified with previousName", () => {
  const left = flowXml(`
  <assignments>
    <name>Old_Assign</name>
    <label>Assign damage details</label>
    <assignmentItems>
      <assignToReference>JobFormRecord.SM_DamageCausedToProperty__c</assignToReference>
      <operator>Assign</operator>
      <value><stringValue>No</stringValue></value>
    </assignmentItems>
  </assignments>`);
  const right = flowXml(`
  <assignments>
    <name>AssdamageNo</name>
    <label>Assign damage details</label>
    <assignmentItems>
      <assignToReference>JobFormRecord.SM_DamageCausedToProperty__c</assignToReference>
      <operator>Assign</operator>
      <value><stringValue>No</stringValue></value>
    </assignmentItems>
  </assignments>`);

  const diff = diffFlowSnapshots(parseFlowXml(left), parseFlowXml(right));
  const renamed = diff.changes.find((c) => c.previousName === "Old_Assign");
  assert.ok(renamed);
  assert.equal(renamed.change, "modified");
  assert.equal(renamed.name, "AssdamageNo");
  assert.ok(renamed.details.some((d) => d.includes("API name changed")));
  assert.equal(diff.changes.some((c) => c.change === "renamed"), false);
});

test("label-only similarity is NOT treated as rename", () => {
  const left = flowXml(`
  <assignments>
    <name>LeftOnly</name>
    <label>Shared Label</label>
    <assignmentItems>
      <assignToReference>JobFormRecord.A__c</assignToReference>
      <operator>Assign</operator>
      <value><stringValue>1</stringValue></value>
    </assignmentItems>
  </assignments>`);
  const right = flowXml(`
  <assignments>
    <name>RightOnly</name>
    <label>Shared Label</label>
    <assignmentItems>
      <assignToReference>JobFormRecord.Z__c</assignToReference>
      <operator>Assign</operator>
      <value><stringValue>9</stringValue></value>
    </assignmentItems>
  </assignments>`);

  const diff = diffFlowSnapshots(parseFlowXml(left), parseFlowXml(right));
  assert.equal(diff.changes.some((c) => c.change === "renamed"), false);
  assert.ok(diff.changes.some((c) => c.change === "removed" && c.name === "LeftOnly"));
  assert.ok(diff.changes.some((c) => c.change === "added" && c.name === "RightOnly"));
});

test("layout noise ignored by default", () => {
  const left = flowXml(`
  <screens>
    <name>S1</name>
    <label>Screen</label>
    <locationX>1</locationX>
    <locationY>2</locationY>
  </screens>`);
  const right = flowXml(`
  <screens>
    <name>S1</name>
    <label>Screen</label>
    <locationX>99</locationX>
    <locationY>88</locationY>
  </screens>`);

  const diff = diffFlowSnapshots(
    parseFlowXml(left, { ignoreLayoutNoise: true }),
    parseFlowXml(right, { ignoreLayoutNoise: true })
  );
  assert.equal(diff.changes.length, 0);
  const md = formatDiffMarkdown(diff, "a", "b");
  assert.match(md, /No functional differences/);
});

test("processMetadataValues ignored when enabled", () => {
  const left = flowXml(`
  <screens>
    <name>S1</name>
    <label>Screen</label>
    <processMetadataValues><name>CanvasMode</name><value><stringValue>AUTO</stringValue></value></processMetadataValues>
  </screens>`);
  const right = flowXml(`
  <screens>
    <name>S1</name>
    <label>Screen</label>
    <processMetadataValues><name>CanvasMode</name><value><stringValue>FREE</stringValue></value></processMetadataValues>
  </screens>`);

  const ignored = diffFlowSnapshots(
    parseFlowXml(left, { ignoreProcessMetadata: true }),
    parseFlowXml(right, { ignoreProcessMetadata: true })
  );
  assert.equal(ignored.changes.length, 0);

  const noticed = diffFlowSnapshots(
    parseFlowXml(left, {
      ignoreLayoutNoise: true,
      ignoreProcessMetadata: false,
    }),
    parseFlowXml(right, {
      ignoreLayoutNoise: true,
      ignoreProcessMetadata: false,
    })
  );
  assert.equal(noticed.changes.length, 1);
});

test("screen field property changes are detailed", () => {
  const left = flowXml(`
  <screens>
    <name>Screen_A</name>
    <label>Screen A</label>
    <fields>
      <name>Reason</name>
      <fieldText>Reason</fieldText>
      <fieldType>ComponentChoice</fieldType>
      <isRequired>true</isRequired>
    </fields>
  </screens>`);
  const right = flowXml(`
  <screens>
    <name>Screen_A</name>
    <label>Screen A Updated</label>
    <fields>
      <name>Reason</name>
      <fieldText>Revisit reason</fieldText>
      <fieldType>ComponentChoice</fieldType>
      <isRequired>false</isRequired>
    </fields>
  </screens>`);

  const diff = diffFlowSnapshots(parseFlowXml(left), parseFlowXml(right));
  const screen = diff.changes.find((c) => c.name === "Screen_A");
  assert.equal(screen.change, "modified");
  assert.ok(screen.details.some((d) => d.includes("Label changed")));
  assert.ok(screen.details.some((d) => d.includes("fieldText")));
  assert.ok(screen.details.some((d) => d.includes("isRequired")));
  assert.ok(
    screen.properties.some(
      (p) => p.path === "label" && p.left === "Screen A" && p.right === "Screen A Updated"
    )
  );
  assert.ok(
    screen.properties.some(
      (p) =>
        p.path === "fields.Reason.isRequired" &&
        p.left === "true" &&
        p.right === "false"
    )
  );
});

test("DC extensionName shows Picklist / Radio not raw runtime names", () => {
  const left = flowXml(`
  <screens>
    <name>Screen_A</name>
    <label>Screen A</label>
    <fields>
      <name>Choice_Field</name>
      <fieldText>Choice</fieldText>
      <fieldType>ComponentInstance</fieldType>
      <extensionName>runtime_service_fieldservice:dcPicklist</extensionName>
    </fields>
  </screens>`);
  const right = flowXml(`
  <screens>
    <name>Screen_A</name>
    <label>Screen A</label>
    <fields>
      <name>Choice_Field</name>
      <fieldText>Choice</fieldText>
      <fieldType>ComponentInstance</fieldType>
      <extensionName>runtime_service_fieldservice:dcRbGroup</extensionName>
    </fields>
  </screens>`);

  const diff = diffFlowSnapshots(parseFlowXml(left), parseFlowXml(right));
  const screen = diff.changes.find((c) => c.name === "Screen_A");
  assert.equal(screen.change, "modified");
  const typeProp = screen.properties.find(
    (p) => p.path === "fields.Choice_Field.elementType"
  );
  assert.ok(typeProp, "elementType property should exist");
  assert.equal(typeProp.left, "Picklist");
  assert.equal(typeProp.right, "Radio");
  assert.ok(
    !JSON.stringify(screen.properties).includes("runtime_service_fieldservice"),
    "should not show raw extension namespace"
  );
  assert.ok(screen.details.some((d) => d.includes("elementType")));
});

test("summary lists nested field differences never generic content changed", () => {
  const left = flowXml(`
  <screens>
    <name>Screen_A</name>
    <label>Screen A</label>
    <fields>
      <name>Choice_Field</name>
      <fieldText>Choice</fieldText>
      <fieldType>ComponentInstance</fieldType>
      <extensionName>runtime_service_fieldservice:dcPicklist</extensionName>
      <visibilityRule>
        <conditionLogic>and</conditionLogic>
        <conditions>
          <leftValue><elementReference>Other</elementReference></leftValue>
          <operator>EqualTo</operator>
          <rightValue><stringValue>Yes</stringValue></rightValue>
        </conditions>
      </visibilityRule>
    </fields>
  </screens>`);
  const right = flowXml(`
  <screens>
    <name>Screen_A</name>
    <label>Screen A</label>
    <fields>
      <name>Choice_Field</name>
      <fieldText>Choice</fieldText>
      <fieldType>ComponentInstance</fieldType>
      <extensionName>runtime_service_fieldservice:dcPicklist</extensionName>
      <visibilityRule>
        <conditionLogic>and</conditionLogic>
        <conditions>
          <leftValue><elementReference>Other</elementReference></leftValue>
          <operator>EqualTo</operator>
          <rightValue><stringValue>No</stringValue></rightValue>
        </conditions>
      </visibilityRule>
    </fields>
  </screens>`);

  const diff = diffFlowSnapshots(parseFlowXml(left), parseFlowXml(right));
  const screen = diff.changes.find((c) => c.name === "Screen_A");
  assert.equal(screen.change, "modified");
  assert.ok(
    screen.properties.some(
      (p) =>
        p.path.includes("visibilityRule") &&
        (p.left === "Yes" || p.right === "No" || p.left.includes("Yes") || p.right.includes("No"))
    ),
    "should list visibility rule value change"
  );
  assert.ok(
    !screen.details.some((d) => d.includes("see XML diff")),
    "must not use generic content-changed message"
  );
});

test("screen field moved between screens is reported as move not remove+add", () => {
  const left = flowXml(`
  <screens>
    <name>Screen2</name>
    <label>Screen 2</label>
    <fields>
      <name>Screen2_Section1</name>
      <fieldType>RegionContainer</fieldType>
      <fields>
        <name>Screen2_Section1_Column1</name>
        <fieldType>Region</fieldType>
        <fields>
          <name>Photoofriserchamber</name>
          <fieldType>ComponentInstance</fieldType>
          <extensionName>runtime_service_fieldservice:dcUpImage</extensionName>
          <isRequired>true</isRequired>
        </fields>
      </fields>
    </fields>
  </screens>
  <screens>
    <name>Screen5</name>
    <label>Screen 5</label>
    <fields>
      <name>KeepMe</name>
      <fieldType>ComponentInstance</fieldType>
      <extensionName>runtime_service_fieldservice:dcTextInput</extensionName>
    </fields>
  </screens>`);
  const right = flowXml(`
  <screens>
    <name>Screen2</name>
    <label>Screen 2</label>
    <fields>
      <name>Screen2_Section1</name>
      <fieldType>RegionContainer</fieldType>
      <fields>
        <name>Screen2_Section1_Column1</name>
        <fieldType>Region</fieldType>
      </fields>
    </fields>
  </screens>
  <screens>
    <name>Screen5</name>
    <label>Screen 5</label>
    <fields>
      <name>KeepMe</name>
      <fieldType>ComponentInstance</fieldType>
      <extensionName>runtime_service_fieldservice:dcTextInput</extensionName>
    </fields>
    <fields>
      <name>Photoofriserchamber</name>
      <fieldType>ComponentInstance</fieldType>
      <extensionName>runtime_service_fieldservice:dcUpImage</extensionName>
      <isRequired>true</isRequired>
    </fields>
  </screens>`);

  const diff = diffFlowSnapshots(parseFlowXml(left), parseFlowXml(right));
  const screen2 = diff.changes.find((c) => c.name === "Screen2");
  const screen5 = diff.changes.find((c) => c.name === "Screen5");
  assert.ok(screen2);
  assert.ok(screen5);
  assert.ok(
    screen2.details.some(
      (d) =>
        d.includes("moved") &&
        d.includes("Photoofriserchamber") &&
        d.includes("Screen5")
    )
  );
  assert.ok(
    screen5.details.some(
      (d) =>
        d.includes("moved") &&
        d.includes("Photoofriserchamber") &&
        d.includes("Screen2")
    )
  );
  assert.ok(
    !screen2.details.some((d) => d.includes("Screen field removed")),
    "should not show plain remove for moved field"
  );
  assert.ok(
    !screen5.details.some((d) => d.includes("Screen field added")),
    "should not show plain add for moved field"
  );
  const photoProps = [
    ...screen2.properties,
    ...screen5.properties,
  ].filter((p) => p.path.includes("Photoofriserchamber"));
  assert.ok(
    photoProps.every(
      (p) =>
        !p.path.includes(".fields.Photoofriserchamber") ||
        p.path.endsWith(".screen")
    )
  );
});

test("same-screen field API rename is one Updated row, not remove+add", () => {
  const left = flowXml(`
  <screens>
    <name>Screen5</name>
    <label>Screen 5</label>
    <fields>
      <name>KeepMe</name>
      <fieldType>ComponentInstance</fieldType>
      <extensionName>runtime_service_fieldservice:dcTextInput</extensionName>
    </fields>
    <fields>
      <name>Photoofriserchamber1</name>
      <fieldType>ComponentInstance</fieldType>
      <extensionName>runtime_service_fieldservice:dcUpImage</extensionName>
      <isRequired>true</isRequired>
      <locationX>100</locationX>
      <locationY>200</locationY>
    </fields>
  </screens>`);
  const right = flowXml(`
  <screens>
    <name>Screen5</name>
    <label>Screen 5</label>
    <fields>
      <name>KeepMe</name>
      <fieldType>ComponentInstance</fieldType>
      <extensionName>runtime_service_fieldservice:dcTextInput</extensionName>
    </fields>
    <fields>
      <name>Photoofriserchamber</name>
      <fieldType>ComponentInstance</fieldType>
      <extensionName>runtime_service_fieldservice:dcUpImage</extensionName>
      <isRequired>true</isRequired>
      <locationX>100</locationX>
      <locationY>200</locationY>
    </fields>
  </screens>`);

  const diff = diffFlowSnapshots(parseFlowXml(left), parseFlowXml(right));
  const screen = diff.changes.find((c) => c.name === "Screen5");
  assert.ok(screen);
  assert.equal(screen.change, "modified");
  assert.ok(
    screen.details.some(
      (d) =>
        d.includes("Screen field renamed") &&
        d.includes("Photoofriserchamber1") &&
        d.includes("Photoofriserchamber")
    )
  );
  assert.ok(
    !screen.details.some((d) => d.includes("Screen field removed")),
    "rename should not appear as remove"
  );
  assert.ok(
    !screen.details.some((d) => d.includes("Screen field added")),
    "rename should not appear as add"
  );
  assert.ok(
    screen.properties.some(
      (p) =>
        p.path === "fields.Photoofriserchamber1→Photoofriserchamber.name" &&
        p.left === "Photoofriserchamber1" &&
        p.right === "Photoofriserchamber"
    )
  );
});

test("same-screen ComponentInstance rename tolerates input order and label drift", () => {
  const left = flowXml(`
  <screens>
    <name>Screen5</name>
    <label>Screen 5</label>
    <fields>
      <name>Photoofriserchamber1</name>
      <extensionName>runtime_service_fieldservice:dcUpImage</extensionName>
      <fieldType>ComponentInstance</fieldType>
      <inputParameters>
        <name>label</name>
        <value><stringValue>Photo of riser/chamber</stringValue></value>
      </inputParameters>
      <inputParameters>
        <name>isRequired</name>
        <value><booleanValue>true</booleanValue></value>
      </inputParameters>
      <inputParameters>
        <name>recordId</name>
        <value><elementReference>getJobFormId.Id</elementReference></value>
      </inputParameters>
      <inputParameters>
        <name>imagesName</name>
        <value><stringValue>Photo of riser/chamber</stringValue></value>
      </inputParameters>
      <isRequired>true</isRequired>
      <storeOutputAutomatically>true</storeOutputAutomatically>
    </fields>
  </screens>`);
  const right = flowXml(`
  <screens>
    <name>Screen5</name>
    <label>Screen 5</label>
    <fields>
      <name>Photoofriserchamber</name>
      <extensionName>runtime_service_fieldservice:dcUpImage</extensionName>
      <fieldType>ComponentInstance</fieldType>
      <inputParameters>
        <name>recordId</name>
        <value><elementReference>getJobFormId.Id</elementReference></value>
      </inputParameters>
      <inputParameters>
        <name>imagesName</name>
        <value><stringValue>Photo of riser chamber</stringValue></value>
      </inputParameters>
      <inputParameters>
        <name>isRequired</name>
        <value><booleanValue>true</booleanValue></value>
      </inputParameters>
      <inputParameters>
        <name>label</name>
        <value><stringValue>Photo of riser chamber</stringValue></value>
      </inputParameters>
      <isRequired>true</isRequired>
      <storeOutputAutomatically>true</storeOutputAutomatically>
    </fields>
  </screens>`);

  const diff = diffFlowSnapshots(parseFlowXml(left), parseFlowXml(right));
  const screen = diff.changes.find((c) => c.name === "Screen5");
  assert.ok(screen);
  assert.ok(
    screen.details.some((d) => d.includes("Screen field renamed")),
    "should collapse real DC image rename despite input reorder/label change"
  );
  assert.ok(!screen.details.some((d) => d.includes("Screen field removed")));
  assert.ok(!screen.details.some((d) => d.includes("Screen field added")));
});

test("same-screen field rename is not used when body differs", () => {
  const left = flowXml(`
  <screens>
    <name>Screen5</name>
    <label>Screen 5</label>
    <fields>
      <name>OldField</name>
      <fieldType>ComponentInstance</fieldType>
      <extensionName>runtime_service_fieldservice:dcUpImage</extensionName>
      <isRequired>true</isRequired>
      <locationX>100</locationX>
      <locationY>200</locationY>
    </fields>
  </screens>`);
  const right = flowXml(`
  <screens>
    <name>Screen5</name>
    <label>Screen 5</label>
    <fields>
      <name>NewField</name>
      <fieldType>ComponentInstance</fieldType>
      <extensionName>runtime_service_fieldservice:dcTextInput</extensionName>
      <isRequired>true</isRequired>
      <locationX>100</locationX>
      <locationY>200</locationY>
    </fields>
  </screens>`);

  const diff = diffFlowSnapshots(parseFlowXml(left), parseFlowXml(right));
  const screen = diff.changes.find((c) => c.name === "Screen5");
  assert.ok(screen);
  assert.ok(screen.details.some((d) => d.includes("Screen field removed")));
  assert.ok(screen.details.some((d) => d.includes("Screen field added")));
  assert.ok(!screen.details.some((d) => d.includes("Screen field renamed")));
});

test("markdown includes property table", () => {
  const left = flowXml(`
  <assignments>
    <name>A1</name>
    <label>A</label>
    <assignmentItems>
      <assignToReference>JobFormRecord.X__c</assignToReference>
      <operator>Assign</operator>
      <value><stringValue>1</stringValue></value>
    </assignmentItems>
  </assignments>`);
  const right = flowXml(`
  <assignments>
    <name>A1</name>
    <label>A</label>
    <assignmentItems>
      <assignToReference>JobFormRecord.X__c</assignToReference>
      <operator>Assign</operator>
      <value><stringValue>2</stringValue></value>
    </assignmentItems>
  </assignments>`);
  const diff = diffFlowSnapshots(parseFlowXml(left), parseFlowXml(right));
  const md = formatDiffMarkdown(diff, "l", "r");
  assert.match(md, /\| Property \| Baseline \| Compare \|/);
  assert.match(md, /assignmentItems\.JobFormRecord\.X__c\.value/);
});

test("findElementLine locates name tag", () => {
  const { findElementLine, findElementLocation } = require("../out/xmlLocate");
  const xml = `<Flow>\n  <assignments>\n    <name>Assequip</name>\n  </assignments>\n</Flow>`;
  assert.equal(findElementLine(xml, "Assequip"), 2);
  assert.equal(
    findElementLocation(xml, "Assequip", { kind: "assignments" }).line,
    2
  );
});

test("findElementLocation prefers actionCalls block and nested field", () => {
  const { findElementLocation } = require("../out/xmlLocate");
  const xml = `<Flow>
  <variables>
    <name>SkipMe</name>
  </variables>
  <actionCalls>
    <name>Call_Apex</name>
    <actionName>MyApex</actionName>
  </actionCalls>
  <screens>
    <name>Screen1</name>
    <fields>
      <name>Reason</name>
      <isRequired>true</isRequired>
    </fields>
  </screens>
</Flow>`;
  assert.equal(
    findElementLocation(xml, "Call_Apex", { kind: "actionCalls" }).line,
    5
  );
  assert.equal(
    findElementLocation(xml, "Screen1", {
      kind: "screens",
      propertyPath: "fields.Reason.isRequired",
    }).line,
    11
  );
});

test("versionLabelFromPath extracts vN", () => {
  const { versionLabelFromPath } = require("../out/versionLabel");
  assert.equal(
    versionLabelFromPath("RevisitForm-v34.flow-meta.xml"),
    "v34"
  );
  assert.equal(
    versionLabelFromPath("/tmp/RevisitForm-v35.flow-meta.xml"),
    "v35"
  );
});

test("verifyFlowFile accepts valid flow and rejects garbage", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dc-flow-"));
  const good = path.join(dir, "RevisitForm-v1.flow-meta.xml");
  fs.writeFileSync(
    good,
    flowXml(`<label>Revisit Form</label><screens><name>S</name><label>S</label></screens>`)
  );
  const verified = verifyFlowFile(good, {
    expectedApiName: "RevisitForm",
    expectedVersion: 1,
    requireDataCapture: true,
  });
  assert.equal(verified.processType, "DataCaptureFlow");
  assert.ok(verified.byteLength > 32);

  const bad = path.join(dir, "bad.xml");
  fs.writeFileSync(bad, "<NotFlow/>");
  assert.throws(
    () => verifyFlowFile(bad),
    (err) => err instanceof FlowVerificationError
  );
});

test("parseSfJson handles leading CLI warnings", () => {
  const stdout = ` ›   Warning: update available
{"status":0,"result":{"records":[{"Id":"1"}]}}
`;
  const parsed = parseSfJson(stdout);
  assert.equal(parsed.status, 0);
  assert.equal(parsed.result.records[0].Id, "1");
});

test("canvas keeps rename plus body diffs for soft screen field rename", () => {
  const { buildUnifiedRows } = require("../out/unifiedTable");
  const left = flowXml(`
  <label>Form</label>
  <screens>
    <name>Screen5</name>
    <label>Screen 5</label>
    <fields>
      <name>Photoofriserchamber1</name>
      <fieldType>ComponentInstance</fieldType>
      <extensionName>runtime_service_fieldservice:dcUpImage</extensionName>
      <isRequired>false</isRequired>
      <inputParameters>
        <name>isRequired</name>
        <value><booleanValue>false</booleanValue></value>
      </inputParameters>
      <inputParameters>
        <name>recordId</name>
        <value><elementReference>getJobFormId.Id</elementReference></value>
      </inputParameters>
    </fields>
  </screens>`);
  const right = flowXml(`
  <label>Form</label>
  <screens>
    <name>Screen5</name>
    <label>Screen 5</label>
    <fields>
      <name>Photoofriserchamber</name>
      <fieldType>ComponentInstance</fieldType>
      <extensionName>runtime_service_fieldservice:dcUpImage</extensionName>
      <isRequired>true</isRequired>
      <inputParameters>
        <name>recordId</name>
        <value><elementReference>getJobFormId.Id</elementReference></value>
      </inputParameters>
      <inputParameters>
        <name>isRequired</name>
        <value><booleanValue>true</booleanValue></value>
      </inputParameters>
    </fields>
  </screens>`);

  const diff = diffFlowSnapshots(parseFlowXml(left), parseFlowXml(right));
  const screen = diff.changes.find((c) => c.name === "Screen5");
  assert.ok(screen);
  assert.ok(screen.details.some((d) => /renamed/i.test(d)));
  assert.ok(
    screen.properties.some((p) => /isRequired/i.test(p.path)),
    "body property change must remain on canvas after rename merge"
  );
  const rows = buildUnifiedRows(diff);
  assert.ok(
    rows.filter((r) => r.name === "Screen5").length >= 2,
    "rename + body change must both appear as canvas rows"
  );
});

test("flow status/label changes appear on canvas as (Flow) rows", () => {
  const { buildUnifiedRows } = require("../out/unifiedTable");
  const left = `<?xml version="1.0" encoding="UTF-8"?>
<Flow xmlns="http://soap.sforce.com/2006/04/metadata">
  <processType>DataCaptureFlow</processType>
  <status>Draft</status>
  <label>Old Label</label>
  <screens><name>S1</name><label>S</label></screens>
</Flow>`;
  const right = `<?xml version="1.0" encoding="UTF-8"?>
<Flow xmlns="http://soap.sforce.com/2006/04/metadata">
  <processType>DataCaptureFlow</processType>
  <status>Active</status>
  <label>New Label</label>
  <screens><name>S1</name><label>S</label></screens>
</Flow>`;
  const diff = diffFlowSnapshots(parseFlowXml(left), parseFlowXml(right));
  const flowChange = diff.changes.find((c) => c.name === "(Flow)");
  assert.ok(flowChange, "flow metadata change must be present");
  assert.ok(flowChange.properties.some((p) => p.path === "status"));
  assert.ok(flowChange.properties.some((p) => p.path === "label"));
  const rows = buildUnifiedRows(diff);
  assert.ok(rows.some((r) => r.name === "(Flow)" && r.propertyPath === "status"));
  assert.ok(rows.some((r) => r.name === "(Flow)" && r.propertyPath === "label"));
});

test("customErrors elements are ingested and shown on canvas", () => {
  const { buildUnifiedRows } = require("../out/unifiedTable");
  const left = flowXml(`
  <label>Form</label>
  <customErrors>
    <name>ShowError</name>
    <label>Show Error</label>
    <customErrorMessages>
      <errorMessage>Old</errorMessage>
      <isFieldError>false</isFieldError>
    </customErrorMessages>
  </customErrors>`);
  const right = flowXml(`
  <label>Form</label>
  <customErrors>
    <name>ShowError</name>
    <label>Show Error</label>
    <customErrorMessages>
      <errorMessage>New</errorMessage>
      <isFieldError>false</isFieldError>
    </customErrorMessages>
  </customErrors>`);
  const diff = diffFlowSnapshots(parseFlowXml(left), parseFlowXml(right));
  const err = diff.changes.find((c) => c.name === "ShowError");
  assert.ok(err, "customErrors must be compared");
  assert.equal(err.kind, "customErrors");
  assert.ok(err.properties.length > 0 || err.details.length > 0);
  assert.ok(buildUnifiedRows(diff).some((r) => r.name === "ShowError"));
});

test("added screen field is one brief row not full property dump", () => {
  const { buildUnifiedRows } = require("../out/unifiedTable");
  const left = flowXml(`
  <label>Form</label>
  <screens>
    <name>Screen2</name>
    <label>Screen 2</label>
    <fields>
      <name>KeepMe</name>
      <fieldType>ComponentInstance</fieldType>
      <extensionName>runtime_service_fieldservice:dcTextInput</extensionName>
    </fields>
  </screens>`);
  const right = flowXml(`
  <label>Form</label>
  <screens>
    <name>Screen2</name>
    <label>Screen 2</label>
    <fields>
      <name>KeepMe</name>
      <fieldType>ComponentInstance</fieldType>
      <extensionName>runtime_service_fieldservice:dcTextInput</extensionName>
    </fields>
    <fields>
      <name>Screen2_Section2</name>
      <fieldType>RegionContainer</fieldType>
      <fields>
        <name>Screen2_Section2_Column1</name>
        <fieldType>Region</fieldType>
        <fields>
          <name>PhotoofsurroundingareaaroundMeter</name>
          <extensionName>runtime_service_fieldservice:dcUpImage</extensionName>
          <fieldType>ComponentInstance</fieldType>
          <inputParameters>
            <name>label</name>
            <value><stringValue>Photo of surrounding area around Meter</stringValue></value>
          </inputParameters>
          <inputParameters>
            <name>isRequired</name>
            <value><booleanValue>true</booleanValue></value>
          </inputParameters>
          <inputParameters>
            <name>recordId</name>
            <value><elementReference>getJobFormId.Id</elementReference></value>
          </inputParameters>
          <isRequired>true</isRequired>
          <storeOutputAutomatically>true</storeOutputAutomatically>
        </fields>
      </fields>
    </fields>
  </screens>`);

  const diff = diffFlowSnapshots(parseFlowXml(left), parseFlowXml(right));
  const screen = diff.changes.find((c) => c.name === "Screen2");
  assert.ok(screen);
  const photoProps = screen.properties.filter((p) =>
    p.path.includes("PhotoofsurroundingareaaroundMeter")
  );
  assert.equal(
    photoProps.length,
    1,
    "one row for the added photo field, not flat+nested dumps"
  );
  assert.ok(
    !photoProps.some(
      (p) =>
        String(p.right).includes("inputParameters=") ||
        String(p.right).includes("styleProperties=")
    ),
    "must not dump full field body on add"
  );
  assert.ok(
    photoProps[0].right.includes("Image Upload"),
    `brief summary should mention Image Upload, got: ${photoProps[0].right}`
  );
  const rows = buildUnifiedRows(diff).filter((r) =>
    (r.propertyPath || "").includes("PhotoofsurroundingareaaroundMeter")
  );
  assert.equal(rows.length, 1);
});

test("choice API case rename shows as Updated choice row not only screen refs", () => {
  const { buildUnifiedRows } = require("../out/unifiedTable");
  const left = flowXml(`
  <label>Form</label>
  <choices>
    <name>Customer_Request</name>
    <choiceText>Customer Request</choiceText>
    <dataType>String</dataType>
    <value><stringValue>Customer_Request</stringValue></value>
  </choices>
  <screens>
    <name>Sc4_1</name>
    <label>Sc4.1</label>
    <fields>
      <name>Sc4_1_Section1</name>
      <fieldType>RegionContainer</fieldType>
      <fields>
        <name>Sc4_1_Section1_Column1</name>
        <fieldType>Region</fieldType>
        <fields>
          <name>OHH_reason</name>
          <choiceReferences>Out_of_Hours_Shut_off_required</choiceReferences>
          <choiceReferences>Traffic_Management</choiceReferences>
          <choiceReferences>Customer_Request</choiceReferences>
          <dataType>String</dataType>
          <fieldType>RadioButtons</fieldType>
          <isRequired>true</isRequired>
        </fields>
      </fields>
    </fields>
  </screens>`);
  const right = flowXml(`
  <label>Form</label>
  <choices>
    <name>Customer_request</name>
    <choiceText>Customer request</choiceText>
    <dataType>String</dataType>
    <value><stringValue>Customer_request</stringValue></value>
  </choices>
  <screens>
    <name>Sc4_1</name>
    <label>Sc4.1</label>
    <fields>
      <name>Sc4_1_Section1</name>
      <fieldType>RegionContainer</fieldType>
      <fields>
        <name>Sc4_1_Section1_Column1</name>
        <fieldType>Region</fieldType>
        <fields>
          <name>OHH_reason</name>
          <choiceReferences>Out_of_Hours_Shut_off_required</choiceReferences>
          <choiceReferences>Traffic_Management</choiceReferences>
          <choiceReferences>Customer_request</choiceReferences>
          <dataType>String</dataType>
          <fieldType>RadioButtons</fieldType>
          <isRequired>true</isRequired>
        </fields>
      </fields>
    </fields>
  </screens>`);

  const diff = diffFlowSnapshots(parseFlowXml(left), parseFlowXml(right));
  const choice = diff.changes.find(
    (c) =>
      c.kind === "choices" &&
      (c.name === "Customer_request" || c.previousName === "Customer_Request")
  );
  assert.ok(choice, "choice rename must appear as its own change");
  assert.equal(choice.change, "modified");
  assert.equal(choice.previousName, "Customer_Request");
  assert.equal(choice.name, "Customer_request");
  assert.equal(
    choice.properties.length,
    1,
    "choice rename must be one property row (name), not name+choiceText+value"
  );
  assert.equal(choice.properties[0].path, "name");
  assert.ok(
    !diff.changes.some(
      (c) =>
        c.kind === "choices" &&
        (c.change === "removed" || c.change === "added")
    ),
    "choice case rename must not stay as remove+add"
  );

  const screen = diff.changes.find((c) => c.name === "Sc4_1");
  assert.ok(screen);
  const choiceRefProps = screen.properties.filter((p) =>
    p.path.includes("choiceReferences")
  );
  assert.ok(
    choiceRefProps.some((p) => /choiceReferences\[\d+\]$/.test(p.path)),
    "keep indexed choiceReferences row"
  );
  assert.ok(
    !choiceRefProps.some((p) => /choiceReferences$/.test(p.path)),
    "drop whole-array choiceReferences when indexed row exists"
  );

  const rows = buildUnifiedRows(diff);
  assert.equal(
    rows.filter((r) => r.kind === "choices").length,
    1,
    "canvas shows one choice row"
  );
  assert.ok(
    rows.some(
      (r) =>
        r.kind === "choices" &&
        r.change === "modified" &&
        (r.previousName === "Customer_Request" ||
          r.element.includes("Customer_Request"))
    )
  );
});
