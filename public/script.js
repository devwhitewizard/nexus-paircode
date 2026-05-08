function showSection(sectionId) {
    document.querySelectorAll('main > section').forEach(s => s.classList.add('hidden'));
    document.getElementById(sectionId).classList.remove('hidden');

    if (sectionId === 'qr-section') {
        startQRFlow();
    }
}

// Pairing Code Flow
const getPairBtn = document.getElementById('getPairBtn');
const phoneNumberInput = document.getElementById('phoneNumber');
const pairResult = document.getElementById('pairResult');
const pairLoading = document.getElementById('pairLoading');
const codeDisplay = document.getElementById('pairingCode');

getPairBtn.addEventListener('click', async () => {
    const number = phoneNumberInput.value.trim();
    if (!number) return alert('Please enter your phone number');

    pairLoading.classList.remove('hidden');
    pairResult.classList.add('hidden');

    try {
        const response = await fetch(`/pair?number=${encodeURIComponent(number)}`);
        const data = await response.json();

        pairLoading.classList.add('hidden');
        if (response.ok && data.code) {
            codeDisplay.innerText = data.code;
            pairResult.classList.remove('hidden');
        } else {
            alert(data.error || 'Failed to get code. Please check your number and try again.');
        }
    } catch (err) {
        pairLoading.classList.add('hidden');
        alert('Network error or server is down. Please try again later.');
    }
});

// QR Code Flow
let qrInterval = null;

async function startQRFlow() {
    const img = document.getElementById('qrImage');
    const placeholder = document.getElementById('qrPlaceholder');
    const status = document.getElementById('qrStatus');

    placeholder.classList.remove('hidden');
    img.classList.add('hidden');
    status.innerText = 'Creating session...';

    try {
        const res = await fetch('/qr-id');
        const { sessionId } = await res.json();

        if (qrInterval) clearInterval(qrInterval);
        
        qrInterval = setInterval(async () => {
            const qrRes = await fetch(`/qr/${sessionId}`);
            if (qrRes.status === 200) {
                const { qr } = await qrRes.json();
                img.src = qr;
                img.classList.remove('hidden');
                placeholder.classList.add('hidden');
                status.innerText = 'Scan this code with WhatsApp';
            } else if (qrRes.status === 202) {
                status.innerText = 'Waiting for WhatsApp...';
            } else {
                clearInterval(qrInterval);
                status.innerText = 'Session expired or closed.';
            }
        }, 3000);

    } catch (err) {
        status.innerText = 'Failed to start QR session.';
    }
}
