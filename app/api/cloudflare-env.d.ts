// Cloudflare Workers ortam tipleri: bu projede kullanılan binding'ler.
// @cloudflare/workers-types `Cloudflare.Env`'i proje tarafından genişletilecek
// şekilde tasarlar; burada D1 binding'ini ekliyoruz.
declare namespace Cloudflare {
  interface Env {
    DB?: D1Database;
  }
}
