// Sayfanın bfcache'ten geri gelip gelmediğini testin okuyabileceği yere yazar.
addEventListener("pageshow", (event) => {
  document.body.dataset.persisted = String(event.persisted);
});
