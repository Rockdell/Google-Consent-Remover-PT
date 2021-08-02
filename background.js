/* jshint browser: true, esversion: 8 */
/* globals chrome, console */

const debugLog = (text) => console.log(`(GoogleConsent) ${text}`);
const consentUrls = [
    "*://consent.google.com/*", 
    "*://consent.youtube.com/*",
    "*://consent.google.pt/*", 
    "*://consent.youtube.pt/*"
];
const getParamsToObject = (string) => Object.fromEntries(string.split("&").map(kv => kv.split("=")));
const makeAsync = (fn, order = (args, cb) => [...args, cb]) => {
    return async (...args) => new Promise(cb => fn.apply(null, order(args, cb)));
};

const setCookie = makeAsync(chrome.cookies.set);
const getAllCookies = makeAsync(chrome.cookies.getAll);
const getAllCookieStores = makeAsync(chrome.cookies.getAllCookieStores);

const findCookieStore = async (filter) => getAllCookieStores().then(stores => stores.find(filter));

const setConsentToYes = async (domain, storeId) => {
    const allConsentCookies = await getAllCookies({
        name: "CONSENT", domain, storeId
    });

    debugLog(`Found ${allConsentCookies.length} consent cookies at ${domain} in store ${storeId}`);

    return Promise.all(allConsentCookies.map(cookie => {
        const consentData = cookie.value.split("+");
        if (consentData[0] === "YES") {
            debugLog(`Cookie ${cookie.value} doesn't need to be changed`);
            return;
        }

        consentData[0] = "YES";
        debugLog(`Changing cookie ${cookie.value} to ${consentData.join("+")}`);

        return setCookie({
            domain: cookie.domain,
            expirationDate: cookie.expirationDate,
            httpOnly: cookie.httpOnly,
            name: cookie.name,
            path: cookie.path,
            sameSite: cookie.sameSite,
            secure: cookie.secure,
            storeId: cookie.storeId,
            url: "https://" + cookie.domain.replace(/^\.*/, ""),
            value: consentData.join("+")
        });
    }));
};

const onCookieChanged = async ({cause, cookie, removed}) => {
    if (cookie.name === "CONSENT" && !removed) {
        findCookieStore(store => store.id === cookie.storeId)
            .then(store => setConsentToYes(cookie.domain, store.id));
    }
};

const skipConsentPage = (details) => {
    const requestUrl = new URL(details.url);
    const getParams = getParamsToObject(requestUrl.search.slice(1));
    const continueUrl = getParams.continue ? window.decodeURIComponent(getParams.continue) : null;
    if (!continueUrl) {
        debugLog("Requesting a consent page without ?continue parameter");
        return {};
    }

    debugLog(`Redirecting to ${continueUrl} from ${requestUrl.href}...`);

    const primaryDomain = requestUrl.hostname.split(".").slice(-2).join(".");
    findCookieStore(store => store.tabIds.includes(details.tabId))
        .then(store => setConsentToYes(primaryDomain, store.id));

    return {
        redirectUrl: continueUrl
    };
};

chrome.cookies.onChanged.addListener(onCookieChanged);
chrome.webRequest.onHeadersReceived.addListener(skipConsentPage, {urls: consentUrls}, ["blocking", "responseHeaders"]);