// Demo analiz worker'ı: ağır senkron parse işlemini ana HTTP sunucusundan ayırır.
// server.mjs bu dosyayı worker_threads ile çalıştırır; sonuç parentPort üzerinden döner.
import { workerData, parentPort } from "node:worker_threads";
import { analyzeDemo } from "./analyze.mjs";

try {
  const result = analyzeDemo(workerData.filePath);
  parentPort.postMessage({ ok: true, result });
} catch (error) {
  const raw = error instanceof Error ? error.message : String(error);
  // Native parser hataları kullanıcıya ham sızmasın; anlaşılır Türkçe mesaj üret.
  const friendly = /magic|header|invalid|corrupt/i.test(raw)
    ? "Demo dosyası bozuk veya desteklenmeyen bir formatta. Maç bittikten sonra oluşan tam .dem dosyasını deneyin."
    : raw.slice(0, 500);
  parentPort.postMessage({ ok: false, error: friendly });
}
