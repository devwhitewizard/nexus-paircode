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
        if (data.code) {
            codeDisplay.innerText = data.code;
            pairResult.classList.remove('hidden');
            startCountdown(120); // 2 minutes
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
let countdownInterval = null;
function startCountdown(seconds) {
    const note = document.querySelector('.expiration-note');
    if (countdownInterval) clearInterval(countdownInterval);
    
    let remaining = seconds;
    countdownInterval = setInterval(() => {
        remaining--;
        const mins = Math.floor(remaining / 60);
        const secs = remaining % 60;
        note.innerText = `This code expires in ${mins}:${secs < 10 ? '0' : ''}${secs}`;
        
        if (remaining <= 0) {
            clearInterval(countdownInterval);
            note.innerText = 'Code expired. Please request a new one.';
            note.style.color = '#ff4b2b';
        }
    }, 1000);
}

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
            const response = await fetch(`/qr/${sessionId}`);
            const data = await response.json();
        
            if (response.status === 200 && data.qr) {
                img.src = data.qr;
                img.classList.remove('hidden');
                placeholder.classList.add('hidden');
                status.innerText = "QR Code active. Scan with WhatsApp.";
            } else if (response.status === 200 && data.paired) {
                clearInterval(qrInterval);
                qrContainer.innerHTML = '<div class="success-icon">✅</div><h3>Paired Successfully!</h3><p>Check your WhatsApp for the session ID.</p>';
                status.innerText = "";
            } else if (response.status === 202) {
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
