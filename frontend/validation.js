// ── Validators ────────────────────────────────────────────────────────────────
const rules = {
  username: v => {
    if (!v) return 'Username is required';
    if (v.length < 3) return 'At least 3 characters';
    if (!/^[a-z0-9_]+$/i.test(v)) return 'Letters, numbers and _ only';
    return null;
  },
  email: v => {
    if (!v) return 'Email is required';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) return 'Enter a valid email';
    return null;
  },
  password: v => {
    if (!v) return 'Password is required';
    if (v.length < 8) return 'At least 8 characters';
    return null;
  },
  confirm: (v, form) => {
    if (!v) return 'Please confirm your password';
    if (v !== form.password.value) return 'Passwords do not match';
    return null;
  },
};

// ── Password strength ─────────────────────────────────────────────────────────
function strength(pw) {
  let score = 0;
  if (pw.length >= 8)  score++;
  if (pw.length >= 12) score++;
  if (/[A-Z]/.test(pw) && /[a-z]/.test(pw)) score++;
  if (/\d/.test(pw))   score++;
  if (/[^A-Za-z0-9]/.test(pw)) score++;
  return score; // 0-5
}

function updateStrengthMeter(pw) {
  const bars  = document.querySelectorAll('.strength-bar span');
  const label = document.querySelector('.strength-label');
  const s     = strength(pw);
  const colors = ['#f87171','#fb923c','#facc15','#34d399','#34d399'];
  const labels = ['Too weak','Weak','Fair','Strong','Very strong'];
  bars.forEach((b, i) => {
    b.style.background = i < s ? colors[Math.max(0, s - 1)] : '#2d3148';
  });
  label.textContent = pw ? labels[Math.max(0, s - 1)] : '';
}

// ── Field validation UI ───────────────────────────────────────────────────────
function validate(input, form) {
  const name = input.name;
  const err  = rules[name]?.(input.value, form) ?? null;
  const icon = input.parentElement.querySelector('.icon');
  const msg  = input.parentElement.nextElementSibling;

  input.classList.toggle('valid',   !err && input.value !== '');
  input.classList.toggle('invalid', !!err && input.value !== '');

  if (icon) {
    if (!input.value) { icon.textContent = ''; return; }
    icon.textContent = err ? '✗' : '✓';
    icon.style.color = err ? '#f87171' : '#34d399';
  }
  if (msg?.classList.contains('error-msg')) msg.textContent = err ?? '';
}

// ── Autocomplete ──────────────────────────────────────────────────────────────
const emailDomains = ['gmail.com','yahoo.com','outlook.com','proton.me','stellar.org'];

function setupAutocomplete(input) {
  const wrap = input.closest('.field');
  const list = wrap.querySelector('.suggestions');

  input.addEventListener('input', () => {
    const val = input.value;
    const at  = val.indexOf('@');
    list.innerHTML = '';

    if (at === -1 || at === val.length - 1) { list.hidden = true; return; }
    const user   = val.slice(0, at + 1);
    const typed  = val.slice(at + 1).toLowerCase();
    const matches = emailDomains.filter(d => d.startsWith(typed) && d !== typed);

    if (!matches.length) { list.hidden = true; return; }

    matches.slice(0, 4).forEach((domain) => {
      const li = document.createElement('li');
      li.textContent = user + domain;
      li.setAttribute('role', 'option');
      li.addEventListener('mousedown', e => {
        e.preventDefault();
        input.value = user + domain;
        list.hidden = true;
        validate(input, input.closest('form'));
      });
      list.appendChild(li);
    });
    list.hidden = false;
  });

  document.addEventListener('click', e => {
    if (!wrap.contains(e.target)) list.hidden = true;
  });
}

// ── Input masking (phone: +1 234 567 8900) ────────────────────────────────────
function setupMask(input) {
  input.addEventListener('input', () => {
    let digits = input.value.replace(/\D/g, '').slice(0, 11);
    if (!digits) { input.value = ''; return; }
    let out = '+' + digits[0];
    if (digits.length > 1)  out += ' ' + digits.slice(1, 4);
    if (digits.length > 4)  out += ' ' + digits.slice(4, 7);
    if (digits.length > 7)  out += ' ' + digits.slice(7, 11);
    input.value = out;
  });
}

// ── Password toggle ───────────────────────────────────────────────────────────
function setupToggle(btn) {
  btn.addEventListener('click', () => {
    const input  = btn.previousElementSibling;
    const hidden = input.type === 'password';
    input.type   = hidden ? 'text' : 'password';
    btn.textContent = hidden ? '🙈' : '👁';
  });
}

// ── Form init ─────────────────────────────────────────────────────────────────
function initForm() {
  const form   = document.getElementById('vault-form');
  const submit = form.querySelector('[type=submit]');
  const banner = form.querySelector('.success-banner');

  // Wire real-time validation
  form.querySelectorAll('input[name]').forEach(input => {
    ['input', 'blur'].forEach(ev =>
      input.addEventListener(ev, () => {
        validate(input, form);
        if (input.name === 'password') updateStrengthMeter(input.value);
        if (input.name === 'confirm')  validate(input, form);
        checkReady();
      })
    );
  });

  function checkReady() {
    const allValid = [...form.querySelectorAll('input[name]')].every(i => {
      const err = rules[i.name]?.(i.value, form);
      return err === null && i.value !== '';
    });
    submit.disabled = !allValid;
  }

  // Autocomplete on email
  setupAutocomplete(form.querySelector('[name=email]'));

  // Mask on phone
  setupMask(form.querySelector('[name=phone]'));

  // Password toggles
  form.querySelectorAll('.toggle-pw').forEach(setupToggle);

  // Submit
  form.addEventListener('submit', e => {
    e.preventDefault();
    banner.style.display = 'block';
    submit.disabled = true;
  });

  checkReady();
}

document.addEventListener('DOMContentLoaded', initForm);
