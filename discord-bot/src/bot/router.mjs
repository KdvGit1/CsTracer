// Etkileşim yönlendirici: her etkileşimde kişiyi hatırlar, komutu/düğmeyi ilgili
// işleyiciye gönderir ve hataları kullanıcıya anlaşılır biçimde döndürür.
import { logger, redact } from "../log.mjs";
import { greeting } from "./text.mjs";
import { EPHEMERAL, errorMessage, parseCid } from "./ui.mjs";
import * as account from "./handlers/account.mjs";
import * as analysis from "./handlers/analysis.mjs";
import * as guild from "./handlers/guild.mjs";
import * as matches from "./handlers/matches.mjs";
import * as misc from "./handlers/misc.mjs";
import * as radio from "./handlers/radio.mjs";
import * as squad from "./handlers/squad.mjs";
import * as stats from "./handlers/stats.mjs";
import { glossaryChoices } from "./text.mjs";

const log = logger("router");

const COMMANDS = {
  baslat: account.baslat,
  yardim: misc.yardim,
  hesap: account.hesap,
  analiz: analysis.analiz,
  kuyruk: analysis.kuyruk,
  maclar: matches.maclar,
  mac: matches.mac,
  profil: stats.profil,
  gelisim: stats.gelisim,
  faceit: stats.faceit,
  karsilastir: stats.karsilastir,
  liderlik: stats.liderlik,
  sunucu: guild.sunucu,
  takim: squad.takim,
  canli: misc.canli,
  sozluk: misc.sozluk,
  premium: misc.premium,
  admin: misc.admin,
  radyo: radio.radyo,
};

const COMPONENTS = {
  m: matches.matchTab,
  d: matches.duelNav,
  dj: matches.duelJump,
  df: matches.duelFilter,
  lib: matches.libraryPage,
  libopen: matches.libraryOpen,
  pick: analysis.pickPlayer,
  share: analysis.shareButton,
  job: analysis.jobButton,
  start: account.startButton,
  set: account.settingButton,
  del: account.deleteButton,
  fcan: stats.faceitAnalyze,
  sqt: squad.squadButton,
  sqp: squad.squadButton,
  sqs: squad.strategySelect,
  livestop: squad.liveStopButton,
  radio: radio.radioComponent,
};

const MODALS = { modal: account.modalSubmit };

function autocomplete(app, interaction) {
  const focused = interaction.options.getFocused(true);
  if (interaction.commandName === "mac") return matches.matchAutocomplete(app, interaction);
  if (interaction.commandName === "sozluk") return glossaryChoices(focused.value);
  if (interaction.commandName === "radyo") return radio.radioAutocomplete(app, interaction);
  if (interaction.commandName === "takim" && focused.name === "takim") return squad.squadAutocomplete(app, interaction);
  return [];
}

async function fail(interaction, error) {
  const message = error?.userFacing || error?.statusCode === 422 ? error.message : "Bir şeyler ters gitti. Birazdan tekrar dene; sorun sürerse bot sahibine haber ver.";
  const payload = { ...errorMessage(message) };
  try {
    if (interaction.deferred || interaction.replied) await interaction.editReply(payload);
    else await interaction.reply({ ...payload, flags: EPHEMERAL });
  } catch {
    try { await interaction.followUp({ ...payload, flags: EPHEMERAL }); } catch { /* etkileşim süresi dolmuş */ }
  }
}

export async function handleInteraction(app, interaction) {
  if (interaction.isAutocomplete()) {
    try { await interaction.respond(autocomplete(app, interaction).slice(0, 25)); } catch { /* süresi geçmiş */ }
    return;
  }
  const memory = app.remember(interaction);
  const ctx = { user: memory.user, previous: memory.previous, greeting: greeting({ user: memory.user, previous: memory.previous }) };
  try {
    if (interaction.isChatInputCommand()) {
      const handler = COMMANDS[interaction.commandName];
      if (!handler) return;
      await handler(app, interaction, ctx);
      return;
    }
    if (interaction.isUserContextMenuCommand()) {
      await stats.userContext(app, interaction, ctx);
      return;
    }
    if (interaction.isButton() || interaction.isStringSelectMenu()) {
      const parts = parseCid(interaction.customId);
      const handler = COMPONENTS[parts[0]];
      if (handler) await handler(app, interaction, parts, ctx);
      return;
    }
    if (interaction.isModalSubmit()) {
      const parts = parseCid(interaction.customId);
      const handler = MODALS[parts[0]];
      if (handler) await handler(app, interaction, parts, ctx);
    }
  } catch (error) {
    if (!error?.userFacing && error?.statusCode !== 422) log.error(`Etkileşim hatası (${interaction.commandName || interaction.customId})`, redact(error?.stack || error));
    await fail(interaction, error);
  }
}
