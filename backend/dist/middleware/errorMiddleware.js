const errorMessages = {
    INVALID_WALLET_ADDRESS: "The wallet address provided is not valid. Please check and try again.",
    INSUFFICIENT_BALANCE: "Your account doesn't have enough balance for this transaction.",
    TRANSACTION_FAILED: "The transaction couldn't be completed. Please try again.",
    NETWORK_ERROR: "Network connection error. Please check your internet and try again.",
    RATE_LIMIT_EXCEEDED: "Too many requests. Please wait a moment and try again.",
    UNAUTHORIZED: "You don't have permission to perform this action.",
    NOT_FOUND: "The requested resource was not found.",
    INVALID_INPUT: "The information you provided is not valid. Please check and try again.",
    TIMEOUT: "The request took too long. Please try again.",
    SERVICE_UNAVAILABLE: "The service is temporarily unavailable. Please try again later.",
    REFRESH_TOKEN_EXPIRED: "Your session has expired. Please log in again.",
    INVALID_TOKEN: "Invalid authentication token. Please log in again.",
};
export function createApiError(code, statusCode = 400, userMessage) {
    const error = new Error(code);
    error.statusCode = statusCode;
    error.isOperational = true;
    error.userMessage = userMessage || errorMessages[code] || "An error occurred. Please try again.";
    return error;
}
export function errorHandler(err, _req, res, _next) {
    const apiError = err;
    const statusCode = apiError.statusCode || 500;
    const userMessage = apiError.userMessage ||
        errorMessages[err.message] ||
        "An unexpected error occurred. Please try again.";
    console.error(`[${new Date().toISOString()}] Error:`, {
        message: err.message,
        statusCode,
        stack: err.stack,
    });
    const response = {
        success: false,
        error: {
            code: err.message,
            message: userMessage,
            ...(process.env.NODE_ENV === "development" && { details: err.message }),
        },
    };
    res.status(statusCode).json(response);
}
export async function asyncHandler(fn) {
    return (req, res, next) => {
        Promise.resolve(fn(req, res, next)).catch(next);
    };
}
