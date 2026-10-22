// The cart and the order in progress live in sessionStorage, so each page of the checkout is plain HTML.
const PRODUCTS = { blue: { name: 'Blue mug', price: 12 }, red: { name: 'Red mug', price: 14 } };
const load = (key, fallback) => JSON.parse(sessionStorage.getItem(key) ?? JSON.stringify(fallback));
const save = (key, value) => sessionStorage.setItem(key, JSON.stringify(value));
const cart = () => load('cart', []);
const order = () => load('order', {});
const escapeHtml = (text) => String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;');
