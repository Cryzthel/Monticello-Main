const test = require("node:test");
const assert = require("node:assert/strict");
const { MIGRATIONS, planMigration, normalizeEmail } = require("./migrateStaffEmails.cjs");

const user = (uid) => ({ uid });

test("an account still on the old address is migrated", () => {
  assert.equal(planMigration({ fromUser: user("a"), toUser: null, staffAtTo: false }).action, "migrate");
});

test("a re-run after migrating reports done, not missing", () => {
  assert.equal(planMigration({ fromUser: null, toUser: user("a"), staffAtTo: true }).action, "done");
});

test("a new address owned by someone else is refused", () => {
  const plan = planMigration({ fromUser: user("a"), toUser: user("b"), staffAtTo: false });
  assert.equal(plan.action, "refuse");
  assert.match(plan.reason, /uid b/);
});

test("a new address held by a non-staff account is not mistaken for done", () => {
  assert.equal(planMigration({ fromUser: null, toUser: user("b"), staffAtTo: false }).action, "missing");
});

test("nothing at either address is missing", () => {
  assert.equal(planMigration({ fromUser: null, toUser: null, staffAtTo: false }).action, "missing");
});

test("the two pairs are the requested addresses, already normalised", () => {
  assert.deepEqual(
    MIGRATIONS.map(({ from, to }) => [from, to]),
    [
      ["monticellovillas@gmail.com", "adminmonticellov@gmail.com"],
      ["guard.test@monticellovillas.ph", "riversantos940@gmail.com"],
    ],
  );
  for (const { from, to } of MIGRATIONS) {
    assert.equal(normalizeEmail(from), from);
    assert.equal(normalizeEmail(to), to);
  }
});
