const {
  parseFlowXml,
  diffFlowSnapshots,
  formatDiffMarkdown,
} = require("../out/flowDiff");

const left = `<?xml version="1.0" encoding="UTF-8"?>
<Flow xmlns="http://soap.sforce.com/2006/04/metadata">
  <processType>DataCaptureFlow</processType>
  <status>Active</status>
  <assignments>
    <name>Assequip</name>
    <label>Assequip</label>
    <assignmentItems>
      <assignToReference>JobFormRecord.SM_AdditionalEquipmentsFitted__c</assignToReference>
      <operator>Assign</operator>
      <value><stringValue>Yes</stringValue></value>
    </assignmentItems>
    <assignmentItems>
      <assignToReference>JobFormRecord.SM_AdditionalEquipment__c</assignToReference>
      <operator>Assign</operator>
      <value><elementReference>AdditionalEquipment.selectedChoiceValues</elementReference></value>
    </assignmentItems>
    <connector><targetReference>IssueResolved</targetReference></connector>
  </assignments>
  <assignments>
    <name>Old_Assign</name>
    <label>Assign damage details</label>
    <assignmentItems>
      <assignToReference>JobFormRecord.SM_DamageCausedToProperty__c</assignToReference>
      <operator>Assign</operator>
      <value><stringValue>No</stringValue></value>
    </assignmentItems>
  </assignments>
  <screens>
    <name>Screen_A</name>
    <label>Screen A</label>
    <fields>
      <name>Reason</name>
      <fieldText>Reason</fieldText>
      <fieldType>ComponentChoice</fieldType>
      <isRequired>true</isRequired>
    </fields>
  </screens>
</Flow>`;

const right = `<?xml version="1.0" encoding="UTF-8"?>
<Flow xmlns="http://soap.sforce.com/2006/04/metadata">
  <processType>DataCaptureFlow</processType>
  <status>Draft</status>
  <assignments>
    <name>Assequip</name>
    <label>Assequip</label>
    <assignmentItems>
      <assignToReference>JobFormRecord.SM_AdditionalEquipmentsFitted__c</assignToReference>
      <operator>Assign</operator>
      <value><stringValue>Yes</stringValue></value>
    </assignmentItems>
    <connector><targetReference>Next_Step</targetReference></connector>
  </assignments>
  <assignments>
    <name>AssdamageNo</name>
    <label>Assign damage details</label>
    <assignmentItems>
      <assignToReference>JobFormRecord.SM_DamageCausedToProperty__c</assignToReference>
      <operator>Assign</operator>
      <value><stringValue>No</stringValue></value>
    </assignmentItems>
  </assignments>
  <screens>
    <name>Screen_A</name>
    <label>Screen A Updated</label>
    <fields>
      <name>Reason</name>
      <fieldText>Revisit reason</fieldText>
      <fieldType>ComponentChoice</fieldType>
      <isRequired>false</isRequired>
    </fields>
  </screens>
</Flow>`;

const diff = diffFlowSnapshots(
  parseFlowXml(left, true),
  parseFlowXml(right, true)
);

const md = formatDiffMarkdown(diff, "left", "right");
console.log(md);
console.log("---");
console.log(JSON.stringify(diff.changes, null, 2));

const assequip = diff.changes.find(
  (c) => c.name === "Assequip" && c.change === "modified"
);
const renamed = diff.changes.find((c) => c.change === "renamed");
const screen = diff.changes.find(
  (c) => c.name === "Screen_A" && c.change === "modified"
);

const checks = [
  [
    "assignment removed detail",
    assequip?.details.some((d) =>
      d.includes("Field assignment removed") &&
      d.includes("SM_AdditionalEquipment__c")
    ),
  ],
  [
    "connector changed detail",
    assequip?.details.some((d) => d.includes("Next connector changed")),
  ],
  [
    "api rename detected",
    renamed?.previousName === "Old_Assign" && renamed?.name === "AssdamageNo",
  ],
  [
    "screen field text changed",
    screen?.details.some((d) => d.includes("fieldText")),
  ],
  [
    "screen required changed",
    screen?.details.some((d) => d.includes("isRequired")),
  ],
];

let failed = false;
for (const [name, ok] of checks) {
  if (!ok) {
    console.error(`FAIL: ${name}`);
    failed = true;
  } else {
    console.log(`ok: ${name}`);
  }
}

if (failed) {
  process.exit(1);
}
console.log("smoke ok");
