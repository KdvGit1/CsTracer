// Discord bileşen ve mesaj yardımcıları (ham API JSON). discord.js bu nesneleri
// doğrudan kabul eder; böylece her görünüm saf veri olarak test edilebilir.
import { AttachmentBuilder, MessageFlags } from "discord.js";

export const EPHEMERAL = MessageFlags.Ephemeral;
export const COLORS = { accent: 0xc8f54d, win: 0xc8f54d, loss: 0xff6f77, tie: 0xf4c95d, info: 0x68d4ff, error: 0xff6f77, faceit: 0xff5500, muted: 0x5d6b64 };

export const STYLE = { primary: 1, secondary: 2, success: 3, danger: 4, link: 5 };

export function button(customId, label, { style = STYLE.secondary, emoji = undefined, disabled = false } = {}) {
  return { type: 2, custom_id: String(customId).slice(0, 100), label: String(label).slice(0, 80), style, disabled, ...(emoji ? { emoji: { name: emoji } } : {}) };
}

export function linkButton(url, label, emoji = undefined) {
  return { type: 2, style: STYLE.link, url, label: String(label).slice(0, 80), ...(emoji ? { emoji: { name: emoji } } : {}) };
}

export function row(...components) {
  return { type: 1, components: components.filter(Boolean).slice(0, 5) };
}

export function select(customId, options, { placeholder = "Seç", min = 1, max = 1, disabled = false } = {}) {
  return {
    type: 1,
    components: [{
      type: 3,
      custom_id: String(customId).slice(0, 100),
      placeholder: placeholder.slice(0, 150),
      min_values: min,
      max_values: Math.min(max, options.length || 1),
      disabled: disabled || !options.length,
      options: (options.length ? options : [{ label: "Seçenek yok", value: "none" }]).slice(0, 25).map((option) => ({
        label: String(option.label).slice(0, 100),
        value: String(option.value).slice(0, 100),
        ...(option.description ? { description: String(option.description).slice(0, 100) } : {}),
        ...(option.emoji ? { emoji: { name: option.emoji } } : {}),
        ...(option.default ? { default: true } : {}),
      })),
    }],
  };
}

export function modal(customId, title, inputs) {
  return {
    custom_id: customId,
    title: title.slice(0, 45),
    components: inputs.map((input) => ({
      type: 1,
      components: [{
        type: 4,
        custom_id: input.id,
        label: input.label.slice(0, 45),
        style: input.paragraph ? 2 : 1,
        required: input.required !== false,
        max_length: input.max || 200,
        ...(input.placeholder ? { placeholder: input.placeholder.slice(0, 100) } : {}),
        ...(input.value ? { value: String(input.value).slice(0, input.max || 200) } : {}),
      }],
    })),
  };
}

export function png(buffer, name) {
  return new AttachmentBuilder(buffer, { name });
}

export function clamp(value, maximum) {
  const text = String(value ?? "").trim();
  return text.length <= maximum ? text : `${text.slice(0, maximum - 1).trimEnd()}…`;
}

export function embed({ title, description, color = COLORS.accent, fields = [], image, thumbnail, footer, author, url } = {}) {
  return {
    ...(title ? { title: clamp(title, 256) } : {}),
    ...(description ? { description: clamp(description, 4096) } : {}),
    ...(url ? { url } : {}),
    color,
    ...(fields.length ? { fields: fields.slice(0, 25).map((field) => ({ name: clamp(field.name, 256), value: clamp(field.value || "—", 1024), inline: Boolean(field.inline) })) } : {}),
    ...(image ? { image: { url: image } } : {}),
    ...(thumbnail ? { thumbnail: { url: thumbnail } } : {}),
    ...(footer ? { footer: { text: clamp(footer, 2048) } } : {}),
    ...(author ? { author: { name: clamp(author, 256) } } : {}),
  };
}

export function errorMessage(message, { components = [] } = {}) {
  return { embeds: [embed({ description: `⚠️ ${message}`, color: COLORS.error })], components, files: [] };
}

export function infoMessage(message, { title = "", components = [], color = COLORS.info } = {}) {
  return { embeds: [embed({ title, description: message, color })], components, files: [] };
}

export function resultEmoji(result) {
  return result === "W" ? "🟢" : result === "L" ? "🔴" : result === "T" ? "🟡" : "⚪";
}

export function resultColor(result) {
  return result === "W" ? COLORS.win : result === "L" ? COLORS.loss : result === "T" ? COLORS.tie : COLORS.muted;
}

export const RESULT_TEXT = { W: "Galibiyet", L: "Mağlubiyet", T: "Beraberlik" };

/** Bileşen kimliği: "önek:parça:parça". İki nokta içeren parçalar desteklenmez. */
export function cid(...parts) {
  const value = parts.map((part) => String(part ?? "")).join(":");
  if (value.length > 100) throw new Error(`custom_id çok uzun: ${value.length}`);
  return value;
}

export function parseCid(value) {
  return String(value || "").split(":");
}
