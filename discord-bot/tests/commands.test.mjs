import assert from "node:assert/strict";
import test from "node:test";
import { allCommands } from "../src/bot/commands.mjs";

const NAME = /^[-_\p{L}\p{N}]{1,32}$/u;

function checkOptions(options, path) {
  assert.ok(options.length <= 25, `${path}: en fazla 25 seçenek`);
  let optionalSeen = false;
  const names = new Set();
  for (const option of options) {
    const where = `${path}.${option.name}`;
    assert.match(option.name, NAME, `${where}: ad kuralı`);
    assert.equal(option.name, option.name.toLowerCase(), `${where}: küçük harf`);
    assert.ok(!names.has(option.name), `${where}: tekrar eden ad`);
    names.add(option.name);
    assert.ok(option.description.length >= 1 && option.description.length <= 100, `${where}: açıklama 1-100 (${option.description.length})`);
    if (option.choices) {
      assert.ok(option.choices.length <= 25, `${where}: en fazla 25 seçim`);
      for (const choice of option.choices) assert.ok(choice.name.length <= 100);
      assert.ok(!option.autocomplete, `${where}: choices ve autocomplete birlikte olamaz`);
    }
    if (option.type === 1 || option.type === 2) {
      checkOptions(option.options || [], where);
    } else {
      if (option.required) assert.ok(!optionalSeen, `${where}: zorunlu seçenekler isteğe bağlılardan önce gelmeli`);
      else optionalSeen = true;
    }
  }
}

test("slash komutları Discord kurallarına uyar", () => {
  const commands = allCommands();
  const chat = commands.filter((command) => !command.type || command.type === 1);
  assert.ok(chat.length <= 100);
  const names = new Set();
  for (const command of chat) {
    assert.match(command.name, NAME, command.name);
    assert.equal(command.name, command.name.toLowerCase());
    assert.ok(!names.has(command.name), `tekrar: ${command.name}`);
    names.add(command.name);
    assert.ok(command.description.length >= 1 && command.description.length <= 100, `${command.name}: açıklama ${command.description.length}`);
    assert.ok(Array.isArray(command.integration_types) && Array.isArray(command.contexts), `${command.name}: kurulum türü ve bağlam`);
    checkOptions(command.options || [], command.name);
  }
  for (const menu of commands.filter((command) => command.type === 2)) {
    assert.ok(menu.name.length <= 32);
    assert.equal(menu.description, undefined);
  }
  assert.ok(JSON.stringify(commands).length < 8000 * 4, "toplam boyut makul");
});

test("sunucu yönetimi gerektiren komutlar yalnız sunucuda", () => {
  const sunucu = allCommands().find((command) => command.name === "sunucu");
  assert.deepEqual(sunucu.contexts, [0]);
  assert.deepEqual(sunucu.integration_types, [0]);
  assert.equal(sunucu.default_member_permissions, String(1 << 5));
  const profil = allCommands().find((command) => command.name === "profil");
  assert.deepEqual(profil.integration_types, [0, 1], "bireysel kullanım: kullanıcıya kurulabilir");
  assert.deepEqual(profil.contexts, [0, 1, 2], "DM ve grup DM'de çalışır");
});
