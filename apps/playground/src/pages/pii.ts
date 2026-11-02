import { captureError, track } from "@vitalscope/sdk";
import "../vitalscope.js";

// URL'de (?email=…&token=…) ve hata mesajında kişisel veri var; hiçbiri gönderilmemeli.
captureError(new Error(`checkout failed for a@b.com with token=xyz (${location.href})`));
track("checkout_started");
