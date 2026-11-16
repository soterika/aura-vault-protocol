import { validateAccessToken } from '../auth.js';
export async function authenticate(req, res, next) {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
        res.status(401).json({ error: 'Missing token' });
        return;
    }
    const payload = await validateAccessToken(header.slice(7));
    if (!payload) {
        res.status(401).json({ error: 'Invalid or expired token' });
        return;
    }
    req.user = payload;
    next();
}
