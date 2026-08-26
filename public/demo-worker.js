// Demo analizi tek, sürümlenmiş yerel parser hattından yapılır. Eski tarayıcı
// worker'ı gerekli Valve olaylarını güvenilir biçimde çıkaramadığı için sahte
// veya yaklaşık değer üretmek yerine açık hata döndürür.
self.onmessage = () => {
  self.postMessage({
    type: "error",
    message: "LOCAL_PARSER_REQUIRED: Portable klasöründeki TRACER-Yerel.cmd ile yerel parserı başlatın.",
  });
};
