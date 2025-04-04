
/**
 * Utility functions for device and browser detection
 */

export interface DeviceInfo {
  deviceType: string;
  browser: string;
  os: string;
  userAgent: string;
}

/**
 * Detects the current device type
 */
export const getDeviceType = (): string => {
  const ua = navigator.userAgent;
  if (/(tablet|ipad|playbook|silk)|(android(?!.*mobi))/i.test(ua)) {
    return "Tablet";
  }
  if (/Mobile|Android|iP(hone|od)|IEMobile|BlackBerry|Kindle|Silk-Accelerated|(hpw|web)OS|Opera M(obi|ini)/.test(ua)) {
    return "Mobile";
  }
  return "Desktop";
};

/**
 * Detects the current browser
 */
export const getBrowser = (): string => {
  const ua = navigator.userAgent;
  
  if (ua.indexOf("Chrome") > -1) return "Chrome";
  if (ua.indexOf("Safari") > -1) return "Safari";
  if (ua.indexOf("Firefox") > -1) return "Firefox";
  if (ua.indexOf("MSIE") > -1 || ua.indexOf("Trident/") > -1) return "Internet Explorer";
  if (ua.indexOf("Edge") > -1) return "Edge";
  if (ua.indexOf("Opera") > -1) return "Opera";
  
  return "Unknown";
};

/**
 * Detects the current operating system
 */
export const getOS = (): string => {
  const ua = navigator.userAgent;
  
  if (ua.indexOf("Win") > -1) return "Windows";
  if (ua.indexOf("Mac") > -1) return "macOS";
  if (ua.indexOf("Linux") > -1) return "Linux";
  if (ua.indexOf("Android") > -1) return "Android";
  if (/(iPhone|iPad|iPod)/.test(ua)) return "iOS";
  
  return "Unknown";
};

/**
 * Gets the complete device information
 */
export const getDeviceInfo = (): DeviceInfo => {
  return {
    deviceType: getDeviceType(),
    browser: getBrowser(),
    os: getOS(),
    userAgent: navigator.userAgent
  };
};
