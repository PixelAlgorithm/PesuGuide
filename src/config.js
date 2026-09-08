/**
 * PESU Academy Configuration and Endpoints
 * Configurable selectors, constants, and API endpoints.
 */
export const CONFIG = {
  BASE_URL: 'https://www.pesuacademy.com',
  ACADEMY_PATH: '/Academy',

  // API Endpoints
  ENDPOINTS: {
    SEMESTERS: '/Academy/s/studentProfile/getStudentSemestersPESU',
    ADMIN_AJAX: '/Academy/s/studentProfilePESUAdmin',
    STUDENT_PROFILE: '/Academy/s/studentProfilePESU',
    DOWNLOAD_SLIDE_BASE: '/Academy/a/referenceMeterials/downloadslidecoursedoc/'
  },

  // Controller and Action parameters
  CONTROLLER_MODE: 6403,
  MENU_ID: 653,
  SUB_TYPE: 3,

  ACTIONS: {
    GET_SUBJECTS: 38,
    GET_UNITS: 42,
    GET_CLASSES: 43,
    GET_CLASS_CONTENT: 44,
    GET_SLIDES: 60
  },

  CONTENT_TYPES: {
    AV_SUMMARY: 1,
    SLIDES: 2,
    NOTES: 3,
    FORUMS: 4,
    ASSIGNMENTS: 5,
    QB: 6,
    QA: 7,
    MCQS: 8,
    REFERENCES: 9,
    LIVE_VIDEOS: 10
  },

  // Fallback DOM Selectors for scraping active page
  SELECTORS: {
    CSRF_TOKEN: 'meta[name="csrf-token"], meta[name="_csrf"]',
    SEMESTER_SELECT: '#semesters',
    COURSES_TABLE: 'table.table-hover',
    COURSE_ROWS: 'tr[id^="rowWiseCourseContent_"]',
    UNIT_TABS: '#courselistunit li a',
    CLASSES_TABLE: '#CourseContentId table',
    SLIDE_LINKS: '.content-type-area .link-preview a[onclick*="loadIframe"]',
    BREADCRUMB_BACK: '.cmc_breadcrum .back_link'
  },

  // Download and Conversion defaults
  DOWNLOADS: {
    ROOT_FOLDER: 'PESU_Academy',
    CONCURRENT_DOWNLOADS: 3,
    RETRY_ATTEMPTS: 3,
    RETRY_DELAY_MS: 1500
  },

  // Optional Local Companion Server for PowerPoint AppleScript / LibreOffice conversion
  LOCAL_SERVER: {
    DEFAULT_PORT: 8765,
    URL: 'http://127.0.0.1:8765/convert',
    PING_URL: 'http://127.0.0.1:8765/ping'
  }
};
