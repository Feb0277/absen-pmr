const express   = require('express');
const puppeteer = require('puppeteer');
const path      = require('path');
const fs        = require('fs');
const app       = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// ===== PATH FILE =====
const siswaPath = path.join(__dirname, 'siswa.json');
const logoPath  = path.join(__dirname, 'public', 'logo_pmr.png');

// ===== LOGO BASE64 =====
const logoBase64 = fs.existsSync(logoPath)
  ? `data:image/png;base64,${fs.readFileSync(logoPath).toString('base64')}`
  : '';

// ===== HELPER BACA/TULIS SISWA =====
function bacaSiswa() {
  return JSON.parse(fs.readFileSync(siswaPath, 'utf8'));
}
function simpanSiswa(data) {
  fs.writeFileSync(siswaPath, JSON.stringify(data, null, 2));
}

// ===== FORMAT TANGGAL =====
function formatTgl(str) {
  if (!str) return '';
  const [y, m, d] = str.split('-');
  return `${d}/${m}/${y}`;
}

// ===== API: AMBIL SEMUA SISWA =====
app.get('/api/siswa', (req, res) => {
  res.json(bacaSiswa());
});

// ===== API: TAMBAH SISWA =====
app.post('/api/siswa', (req, res) => {
  const { nisn, nama, kelas } = req.body;
  if (!nisn || !nama || !kelas) {
    return res.status(400).json({ error: 'NISN, Nama, dan Kelas wajib diisi!' });
  }
  const data = bacaSiswa();
  // Cek duplikat NISN
  if (data.find(s => s.nisn === nisn)) {
    return res.status(400).json({ error: 'NISN sudah terdaftar!' });
  }
  data.push({ nisn, nama, kelas });
  simpanSiswa(data);
  res.json({ success: true, pesan: 'Siswa berhasil ditambahkan!' });
});

// ===== API: HAPUS SISWA =====
app.delete('/api/siswa/:nisn', (req, res) => {
  const nisn = req.params.nisn;
  let data   = bacaSiswa();
  const awal = data.length;
  data       = data.filter(s => s.nisn !== nisn);
  if (data.length === awal) {
    return res.status(404).json({ error: 'Siswa tidak ditemukan!' });
  }
  simpanSiswa(data);
  res.json({ success: true, pesan: 'Siswa berhasil dihapus!' });
});

// ===== API: EDIT SISWA =====
app.put('/api/siswa/:nisn', (req, res) => {
  const nisn = req.params.nisn;
  const { nama, kelas } = req.body;
  let data = bacaSiswa();
  const idx = data.findIndex(s => s.nisn === nisn);
  if (idx === -1) {
    return res.status(404).json({ error: 'Siswa tidak ditemukan!' });
  }
  data[idx].nama  = nama;
  data[idx].kelas = kelas;
  simpanSiswa(data);
  res.json({ success: true, pesan: 'Data siswa berhasil diupdate!' });
});

// ===== GENERATE PDF =====
app.post('/generate-pdf', async (req, res) => {
  try {
    const { pelatih, tahun, tanggal } = req.body;
    const dataSiswa = (req.body.sumber === 'manual' && req.body.siswaManual?.length > 0)
  ? req.body.siswaManual
  : bacaSiswa();

    // Baca template
    const templatePath = path.join(__dirname, 'templates', 'daftar-hadir.html');
    let html = fs.readFileSync(templatePath, 'utf8');

    // Header tanggal
    const headerTanggal = tanggal
      .map(t => `<th>${formatTgl(t)}</th>`)
      .join('');

    // Baris siswa
    const barisSiswa = dataSiswa.map((s, i) => {
      const checkboxes = tanggal.map((_, k) =>
  `<td><span class="checkbox">${s.checks[k] ? '✔' : ''}</span></td>`
).join('');
      return `
        <tr>
          <td>${i + 1}</td>
          <td>${s.nisn}</td>
          <td class="td-nama">${s.nama}</td>
          <td>${s.kelas}</td>
          ${checkboxes}
        </tr>`;
    }).join('');

    // Inject data ke template
    html = html
      .replace('{{logo}}',          logoBase64)
      .replace('{{tahun}}',         tahun)
      .replace('{{pelatih}}',       pelatih)
      .replace('{{jumlahTanggal}}', tanggal.length)
      .replace('{{headerTanggal}}', headerTanggal)
      .replace('{{barisSiswa}}',    barisSiswa);

    // Puppeteer
    const browser = await puppeteer.launch({
      headless: 'new',
      args: ['--allow-file-access-from-files', '--disable-web-security']
    });
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0' });

    const pdf = await page.pdf({
      format         : 'A4',
      landscape      : true,
      printBackground: true,
      margin         : { top: '10mm', bottom: '10mm', left: '10mm', right: '10mm' }
    });

    await browser.close();

    res.set({
      'Content-Type'       : 'application/pdf',
      'Content-Disposition': 'attachment; filename=daftar-hadir-pmr.pdf'
    });
    res.send(pdf);
    console.log('✅ PDF berhasil digenerate!');

  } catch (err) {
    console.error('❌ Error:', err.message);
    res.status(500).send('Gagal generate PDF');
  }
});

// ===== GENERATE PDF ABSEN (dari absen.html) =====
app.post('/generate-pdf-absen', async (req, res) => {
  try {
    const { pelatih, tahun, tanggal, absensi } = req.body;

    const templatePath = path.join(__dirname, 'templates', 'daftar-hadir.html');
    let html = fs.readFileSync(templatePath, 'utf8');

    // Header tanggal
    const headerTanggal = tanggal
      .map(t => `<th>${formatTgl(t)}</th>`)
      .join('');

    // Baris siswa dengan data centang dari absen.html
    const barisSiswa = absensi.map((s, i) => {
      const checkboxes = tanggal.map((_, k) =>
        `<td><span class="checkbox">${s.checks[k] ? '✔' : ''}</span></td>`
      ).join('');
      return `
        <tr>
          <td>${i + 1}</td>
          <td>${s.nisn}</td>
          <td class="td-nama">${s.nama}</td>
          <td>${s.kelas}</td>
          ${checkboxes}
        </tr>`;
    }).join('');

    html = html
      .replace('{{logo}}',          logoBase64)
      .replace('{{tahun}}',         tahun)
      .replace('{{pelatih}}',       pelatih)
      .replace('{{jumlahTanggal}}', tanggal.length)
      .replace('{{headerTanggal}}', headerTanggal)
      .replace('{{barisSiswa}}',    barisSiswa);

    const browser = await puppeteer.launch({
      headless: 'new',
      args: ['--allow-file-access-from-files', '--disable-web-security', '--no-sandbox']
    });
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0' });

    const pdf = await page.pdf({
      format         : 'A4',
      landscape      : true,
      printBackground: true,
      margin         : { top: '10mm', bottom: '10mm', left: '10mm', right: '10mm' }
    });

    await browser.close();

    res.set({
      'Content-Type'       : 'application/pdf',
      'Content-Disposition': 'attachment; filename=daftar-hadir-pmr.pdf'
    });
    res.send(pdf);
    console.log('✅ PDF Absen berhasil digenerate!');

  } catch(err) {
    console.error('❌ Error:', err.message);
    res.status(500).send('Gagal generate PDF');
  }
});

app.get('/ping', (req, res) => res.send('✅ Server Absen PMR berjalan!'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server berjalan di port ${PORT}`);
});