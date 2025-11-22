/**
 * =======================================================
 * PAWS — SCRIPT.JS (DINAMIS GOOGLE SHEETS)
 * =======================================================
 *
 * FITUR UTAMA:
 * 1. Data Konfigurasi (Logo, Kontak, Shipping) & Produk dimuat dari Google Sheets API (GET).
 * 2. Order Submission dikirim ke Google Sheets API (POST).
 * 3. Persistensi Stok dan Keranjang menggunakan localStorage.
 */


// =======================================================
// 1. KONFIGURASI API & VARIABEL GLOBAL (Diisi setelah Fetch)
// =======================================================

// !!! GANTI DENGAN WEB APP URL YANG ANDA DAPATKAN DARI GOOGLE APPS SCRIPT !!!
const API_CONFIG_URL = "https://script.google.com/macros/s/AKfycbwuOMy8e3evcpdSPrf8TSAeLu7j9Opj9zXkEyhnyet3ry_OYAbNPMn_ftsGP4OCQvIQ/exec"; 

let PRODUCTS = []; // Array produk utama yang dimuat dari Sheets
let STOCK_OVERRIDE = {}; // Stok real-time yang disimpan di localStorage
let BANNERS = []; // Array banner yang dimuat dari Sheets

// Konfigurasi dinamis (diisi dari Sheets)
let WHATSAPP_NUMBER;
let TELEGRAM_USERNAME;
let FREE_SHIPPING_THRESHOLD;
let SHIPPING_FLAT;
let SITE_TITLE;
let SITE_DESCRIPTION;


// =======================================================
// 2. FUNGSI UTILITY (FORMATTING & HELPER)
// =======================================================

/** Mengubah angka menjadi format Rupiah. */
const formatRupiah = (number) => {
    return new Intl.NumberFormat('id-ID', {
        style: 'currency',
        currency: 'IDR',
        minimumFractionDigits: 0
    }).format(number);
};

/** Mengambil data dari localStorage (Stok & Cart). */
const getStorage = (key, defaultValue) => {
    try {
        const stored = localStorage.getItem(key);
        return stored ? JSON.parse(stored) : defaultValue;
    } catch (e) {
        console.error("Error reading localStorage key:", key, e);
        return defaultValue;
    }
};

/** Menyimpan data ke localStorage. */
const setStorage = (key, value) => {
    try {
        localStorage.setItem(key, JSON.stringify(value));
    } catch (e) {
        console.error("Error writing localStorage key:", key, e);
    }
};

/** Menghasilkan ID unik untuk order. */
const generateOrderID = () => `PAWS-${Date.now().toString(36).toUpperCase()}`;

// =======================================================
// 3. LOGIKA KERANJANG (CART) & STOK
// =======================================================

let cart = getStorage('cart', []);

/** Mengupdate jumlah item di header cart. */
const updateCartCount = () => {
    const totalItems = cart.reduce((sum, item) => sum + item.quantity, 0);
    document.getElementById('cart-count').textContent = totalItems;
    document.getElementById('cart-empty-message').style.display = totalItems === 0 ? 'block' : 'none';
};

/** Mendapatkan stok aktual produk (menggunakan override dari localStorage jika ada). */
const getProductStock = (productId, size) => {
    const product = PRODUCTS.find(p => p.id === productId);
    if (!product) return 0;
    
    const initialStock = product.sizes[size] || 0;
    const stockKey = `${productId}_${size}`;
    
    const override = STOCK_OVERRIDE[stockKey];
    return override !== undefined ? override : initialStock;
};

/** Mengupdate stok di localStorage setelah pembelian. */
const updateStockAfterPurchase = (items) => {
    items.forEach(item => {
        const stockKey = `${item.id}_${item.size}`;
        const currentStock = getProductStock(item.id, item.size);
        
        // Hitung stok baru
        const newStock = Math.max(0, currentStock - item.quantity);
        
        // Simpan ke override
        STOCK_OVERRIDE[stockKey] = newStock;
    });
    setStorage('stock_override', STOCK_OVERRIDE);
    renderProducts(PRODUCTS); // Re-render produk untuk menampilkan stok baru/sold out
};


// =======================================================
// 4. FUNGSI RENDER (PRODUK, BANNER, CART)
// =======================================================

/** Merender tampilan produk di grid. */
const renderProducts = (products) => {
    const grid = document.getElementById('product-grid');
    grid.innerHTML = ''; // Bersihkan grid
    document.getElementById('loading-products').style.display = 'none';

    if (products.length === 0) {
        grid.innerHTML = '<p style="grid-column: 1 / -1; text-align: center;">Tidak ada produk tersedia saat ini.</p>';
        return;
    }

    products.forEach(product => {
        const sizes = Object.keys(product.sizes).filter(size => getProductStock(product.id, size) > 0);
        const totalStock = Object.values(product.sizes).reduce((sum, stock) => sum + getProductStock(product.id, size), 0);
        const isSoldOut = totalStock === 0;
        
        const card = document.createElement('div');
        card.className = 'product-card';
        card.innerHTML = `
            ${isSoldOut ? '<div class="sold-out-overlay">SOLD OUT</div>' : ''}
            <img src="${product.image}" alt="${product.name}" loading="lazy" />
            <div class="product-meta">
                <h3>${product.name}</h3>
                <div class="price">
                    ${formatRupiah(product.price)}
                    ${product.badge ? `<span class="badge">${product.badge}</span>` : ''}
                </div>
            </div>
            <div class="product-actions">
                <select class="product-size-select" data-id="${product.id}" ${isSoldOut ? 'disabled' : ''}>
                    ${sizes.map(size => `<option value="${size}">${size} (Stok: ${getProductStock(product.id, size)})</option>`).join('')}
                    ${sizes.length === 0 && !isSoldOut ? '<option disabled selected>Ukuran Habis</option>' : ''}
                </select>
                <button class="btn-add-to-cart" data-id="${product.id}" ${isSoldOut || sizes.length === 0 ? 'disabled' : ''}>
                    Beli
                </button>
                <button class="btn-view-specs" data-desc="${product.desc}">
                    Spek
                </button>
            </div>
        `;
        grid.appendChild(card);
    });
    attachProductEventListeners();
};

/** Merender item di cart modal. */
const renderCart = () => {
    const container = document.getElementById('cart-items-container');
    container.innerHTML = '';
    
    if (cart.length === 0) {
        document.getElementById('cart-empty-message').style.display = 'block';
        document.getElementById('cart-summary').style.display = 'none';
        document.getElementById('checkout-form').style.display = 'none';
        return;
    }
    
    document.getElementById('cart-empty-message').style.display = 'none';
    document.getElementById('cart-summary').style.display = 'block';
    document.getElementById('checkout-form').style.display = 'block';

    cart.forEach((item, index) => {
        const product = PRODUCTS.find(p => p.id === item.id);
        if (!product) return; // Skip jika produk tidak ditemukan

        const row = document.createElement('div');
        row.className = 'cart-item-row';
        row.innerHTML = `
            <img src="${product.image}" alt="${product.name}" />
            <div class="cart-item-details">
                <strong>${product.name}</strong> (${item.size})
                <small>Qty: ${item.quantity} x ${formatRupiah(product.price)} = ${formatRupiah(item.quantity * product.price)}</small>
            </div>
            <div class="cart-item-actions">
                <button data-index="${index}" class="btn-remove-item" title="Hapus Item"><i class="fas fa-trash"></i></button>
            </div>
        `;
        container.appendChild(row);
    });
    
    updateCartSummary();
};

/** Mengupdate subtotal, ongkir, dan grand total. */
const updateCartSummary = () => {
    const subtotal = cart.reduce((sum, item) => {
        const product = PRODUCTS.find(p => p.id === item.id);
        return sum + (product ? item.quantity * product.price : 0);
    }, 0);
    
    let shippingCost = SHIPPING_FLAT;
    let shippingMessage = `Rp ${SHIPPING_FLAT.toLocaleString('id-ID')}`;
    
    if (subtotal >= FREE_SHIPPING_THRESHOLD) {
        shippingCost = 0;
        shippingMessage = `GRATIS (Belanja di atas ${formatRupiah(FREE_SHIPPING_THRESHOLD)})`;
    }

    const grandTotal = subtotal + shippingCost;

    document.getElementById('summary-subtotal').querySelector('span').textContent = formatRupiah(subtotal);
    document.getElementById('summary-shipping').querySelector('span').innerHTML = shippingMessage;
    document.getElementById('summary-grandtotal').textContent = formatRupiah(grandTotal);

    setStorage('cart_grandtotal', grandTotal);
    setStorage('cart_shippingcost', shippingCost);
    setStorage('cart_subtotal', subtotal);
};


/** Merender Banner Carousel. */
const renderBanner = () => {
    const container = document.getElementById('banner-container');
    if (!container) return;

    container.innerHTML = '';
    
    if (BANNERS.length === 0) {
        container.innerHTML = '<img src="https://via.placeholder.com/1400x600?text=Banner+Belum+Diisi" alt="Banner Default" style="width:100%; height:100%; object-fit:cover;" />';
        return;
    }

    const dotsContainer = document.createElement('div');
    dotsContainer.className = 'banner-dots';

    BANNERS.forEach((banner, index) => {
        const item = document.createElement('a');
        item.href = banner.link;
        item.className = `hero-banner-item ${index === 0 ? 'active' : ''}`;
        item.innerHTML = `<img src="${banner.img}" alt="${banner.alt}" loading="lazy">`;
        container.appendChild(item);

        const dot = document.createElement('span');
        dot.className = `dot ${index === 0 ? 'active' : ''}`;
        dot.dataset.index = index;
        dotsContainer.appendChild(dot);
    });

    // Tambahkan navigasi
    container.insertAdjacentHTML('afterend', `
        <button class="banner-nav prev"><i class="fas fa-chevron-left"></i></button>
        <button class="banner-nav next"><i class="fas fa-chevron-right"></i></button>
    `);
    container.insertAdjacentElement('afterend', dotsContainer);
    
    attachBannerEventListeners();
};


// =======================================================
// 5. LOGIKA EKSEKUSI BANNER
// =======================================================

let currentBannerIndex = 0;
let bannerItems;

const showBanner = (index) => {
    if (!bannerItems) return;
    
    bannerItems.forEach((item, i) => {
        item.classList.remove('active');
        document.querySelector(`.banner-dots .dot[data-index="${i}"]`)?.classList.remove('active');
    });

    currentBannerIndex = (index + BANNERS.length) % BANNERS.length;
    bannerItems[currentBannerIndex].classList.add('active');
    document.querySelector(`.banner-dots .dot[data-index="${currentBannerIndex}"]`)?.classList.add('active');
};

const nextBanner = () => showBanner(currentBannerIndex + 1);
const prevBanner = () => showBanner(currentBannerIndex - 1);


// =======================================================
// 6. EVENT LISTENERS
// =======================================================

/** Mengattach listeners ke tombol Beli, Spek, dan Cart. */
const attachProductEventListeners = () => {
    document.querySelectorAll('.btn-add-to-cart').forEach(button => {
        button.onclick = (e) => {
            const id = e.currentTarget.dataset.id;
            const sizeSelect = e.currentTarget.parentNode.querySelector('.product-size-select');
            const size = sizeSelect.value;
            
            if (size) {
                addToCart(id, size);
            } else {
                toast("Pilih ukuran terlebih dahulu!");
            }
        };
    });
    
    document.querySelectorAll('.btn-view-specs').forEach(button => {
        button.onclick = (e) => {
            // Logika menampilkan modal spek (TIDAK DIBUAT di sini, hanya contoh toast)
            toast(`Deskripsi Produk: ${e.currentTarget.dataset.desc}`);
        };
    });
};

/** Logika penambahan ke keranjang. */
const addToCart = (productId, size, quantity = 1) => {
    const stock = getProductStock(productId, size);
    if (stock < quantity) {
        return toast("Stok tidak mencukupi!");
    }

    const existingItemIndex = cart.findIndex(item => item.id === productId && item.size === size);

    if (existingItemIndex > -1) {
        const newQty = cart[existingItemIndex].quantity + quantity;
        if (newQty > stock) {
            return toast(`Hanya tersedia ${stock} item.`);
        }
        cart[existingItemIndex].quantity = newQty;
    } else {
        const product = PRODUCTS.find(p => p.id === productId);
        if (!product) return toast("Produk tidak valid.");
        
        cart.push({ id: productId, size, quantity, price: product.price, name: product.name });
    }

    setStorage('cart', cart);
    updateCartCount();
    toast(`${quantity} item ditambahkan ke keranjang.`);
};


/** Mengattach listeners ke tombol hapus di cart. */
const attachCartEventListeners = () => {
    document.getElementById('cart-items-container').onclick = (e) => {
        if (e.target.closest('.btn-remove-item')) {
            const button = e.target.closest('.btn-remove-item');
            const index = parseInt(button.dataset.index);
            
            cart.splice(index, 1);
            setStorage('cart', cart);
            updateCartCount();
            renderCart();
            toast("Item dihapus.");
        }
    };
};

/** Mengattach listeners ke banner nav. */
const attachBannerEventListeners = () => {
    document.querySelector('.banner-nav.prev').onclick = prevBanner;
    document.querySelector('.banner-nav.next').onclick = nextBanner;
    document.querySelectorAll('.banner-dots .dot').forEach(dot => {
        dot.onclick = (e) => showBanner(parseInt(e.target.dataset.index));
    });
    // Set up auto-slide
    setInterval(nextBanner, 5000); 
    bannerItems = document.querySelectorAll('.hero-banner-item');
    if (bannerItems.length > 0) showBanner(0); // Tampilkan banner pertama setelah listeners siap
};


/** Menangani proses checkout dan mengirim data ke Google Sheets (POST). */
const processCheckout = async (e) => {
    e.preventDefault();
    
    // 1. Ambil data form
    const customerName = document.getElementById('checkout-name').value;
    const customerPhone = document.getElementById('checkout-phone').value;
    const customerAddress = document.getElementById('checkout-address').value;
    const notes = document.getElementById('checkout-notes').value;
    
    // Validasi No HP (hanya angka dan minimal 8 digit, idealnya dimulai 62)
    const phoneRegex = /^\d{8,15}$/; 
    if (!phoneRegex.test(customerPhone)) {
        return alert("Nomor HP tidak valid. Masukkan hanya angka (minimal 8 digit).");
    }

    const orderId = generateOrderID();
    const subtotal = getStorage('cart_subtotal', 0);
    const shippingCost = getStorage('cart_shippingcost', 0);
    const grandTotal = getStorage('cart_grandtotal', 0);
    
    // 2. Format data untuk Google Sheets
    const orderPayload = {
        orderId,
        customerName,
        customerPhone,
        customerAddress,
        notes,
        totalAmount: subtotal,
        shippingCost: shippingCost,
        grandTotal: grandTotal,
        items: cart.map(item => ({
            id: item.id, 
            name: item.name, 
            size: item.size, 
            qty: item.quantity, 
            price: item.price
        }))
    };
    
    document.getElementById('btn-confirm-checkout').disabled = true;
    document.getElementById('btn-confirm-checkout').textContent = "Memproses Pesanan...";

    try {
        // 3. Kirim ke Google Sheets API (POST)
        const response = await fetch(API_CONFIG_URL, {
            method: 'POST',
            body: JSON.stringify(orderPayload),
            headers: {
                'Content-Type': 'application/json'
            }
        });

        const result = await response.json();

        if (result.success) {
            // 4. Update Stok & Kirim Konfirmasi WA
            updateStockAfterPurchase(cart);
            sendWhatsAppConfirmation(orderPayload, grandTotal);
            
            // 5. Reset Cart & UI
            cart = [];
            setStorage('cart', cart);
            updateCartCount();
            closeModal('modal-cart');
            toast(`Pesanan ${orderId} berhasil dibuat!`);

        } else {
            alert("Gagal mencatat pesanan di server. Coba lagi.");
            console.error("Server Error:", result);
        }

    } catch (error) {
        alert("Terjadi kesalahan koneksi. Coba lagi atau hubungi admin.");
        console.error("Fetch Error:", error);
    } finally {
        document.getElementById('btn-confirm-checkout').disabled = false;
        document.getElementById('btn-confirm-checkout').textContent = "Pesan Sekarang";
    }
};

/** Membuat dan membuka link WhatsApp. */
const sendWhatsAppConfirmation = (order, total) => {
    let message = `*PAWS ORDER # ${order.orderId}*\n\n`;
    message += `Terima kasih, ${order.customerName}! Pesanan Anda telah kami terima.\n\n`;
    
    message += `*Detail Pesanan:*\n`;
    order.items.forEach(item => {
        message += `• ${item.qty}x ${item.name} (${item.size}) @ ${formatRupiah(item.price)}\n`;
    });
    
    message += `\n*Rincian Biaya:*\n`;
    message += `Subtotal: ${formatRupiah(order.totalAmount)}\n`;
    message += `Ongkir: ${order.shippingCost === 0 ? 'GRATIS' : formatRupiah(order.shippingCost)}\n`;
    message += `*TOTAL TAGIHAN: ${formatRupiah(total)}*\n\n`;
    
    message += `*Info Pengiriman:*\n`;
    message += `Nama: ${order.customerName}\n`;
    message += `Alamat: ${order.customerAddress}\n`;
    message += `No. HP: ${order.customerPhone}\n\n`;
    message += `Kami akan segera memproses pesanan Anda.`;

    const waUrl = `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(message)}`;
    window.open(waUrl, '_blank');
};

/** Logika buka/tutup modal. */
const openModal = (id) => {
    document.getElementById(id).setAttribute('aria-hidden', 'false');
};
const closeModal = (id) => {
    document.getElementById(id).setAttribute('aria-hidden', 'true');
};


// =======================================================
// 7. FUNGSI BOOTING APLIKASI UTAMA
// =======================================================

/** Mengupdate link dan meta tag dari data Sheets. */
const updateDOMFromConfig = () => {
    // 1. Update Logo & Meta Tags
    document.getElementById('site-title').textContent = SITE_TITLE;
    document.getElementById('meta-description').setAttribute('content', SITE_DESCRIPTION);
    
    // 2. Update Floating Buttons
    document.getElementById('float-wa-link').href = `https://wa.me/${WHATSAPP_NUMBER}`;
    document.getElementById('float-telegram-link').href = `https://t.me/${TELEGRAM_USERNAME}`;
    
    // 3. Update Cart Modal Listener
    document.getElementById('btn-open-cart').onclick = () => {
        renderCart();
        openModal('modal-cart');
    };
    document.getElementById('modal-cart').querySelector('.modal-close').onclick = () => closeModal('modal-cart');

    // 4. Update Form Listener
    document.getElementById('checkout-form').onsubmit = processCheckout;
};

/** Fungsi utama setelah data berhasil dimuat. */
const boot = () => {
    console.log("Aplikasi Booting dengan data dari Sheets...");
    
    // 1. Update DOM dari konfigurasi
    updateDOMFromConfig();

    // 2. Render UI
    renderBanner();
    renderProducts(PRODUCTS);
    
    // 3. Inisiasi listeners lain
    attachCartEventListeners();
    updateCartCount(); // Pastikan count benar saat awal load
};

/** FUNGSI AWAL: Memuat konfigurasi dari Google Sheets. */
const loadConfigAndBoot = async () => {
    document.getElementById('loading-products').style.display = 'block';

    try {
        const response = await fetch(API_CONFIG_URL);
        if (!response.ok) throw new Error(`HTTP status: ${response.status}`);
        
        const data = await response.json();
        
        // --- 1. SET VARIABEL GLOBAL ---
        WHATSAPP_NUMBER = data.config.whatsapp_number;
        TELEGRAM_USERNAME = data.config.telegram_username;
        FREE_SHIPPING_THRESHOLD = data.config.free_shipping_threshold;
        SHIPPING_FLAT = data.config.shipping_flat;
        SITE_TITLE = data.config.site_title;
        SITE_DESCRIPTION = data.config.site_description;
        
        PRODUCTS = data.products || [];
        BANNERS = data.banners || [];
        
        // Ambil stok override dari localStorage
        STOCK_OVERRIDE = getStorage('stock_override', {});

        // Set Logo URL di DOM
        const logoImg = document.querySelector('.site-header .logo-image');
        if (logoImg) logoImg.src = data.config.logo_url || '';
        
        // --- 2. JALANKAN APLIKASI ---
        boot(); 
        
    } catch (error) {
        console.error("Gagal memuat konfigurasi dari Google Sheets. Menggunakan mode statis/fallback.", error);
        document.getElementById('loading-products').textContent = "ERROR: Gagal memuat data. Periksa Apps Script URL Anda.";
        // Jika gagal total, Anda bisa mengisi variabel dengan data fallback statis di sini.
    }
};


// =======================================================
// EKSEKUSI
// =======================================================
document.addEventListener("DOMContentLoaded", loadConfigAndBoot);