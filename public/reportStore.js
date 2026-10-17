// Resilient Client-Side Storage & Synchronization for Financial Reports using IndexedDB
(function (global) {
  'use strict';

  var DB_NAME = 'fintech_intelligence_db';
  var DB_VERSION = 1;
  var STORE_NAME = 'reports';

  var dbPromise = null;

  function openDatabase() {
    if (dbPromise) return dbPromise;

    dbPromise = new Promise(function (resolve, reject) {
      if (!('indexedDB' in window)) {
        console.warn('IndexedDB not supported, falling back to memory storage');
        resolve(null);
        return;
      }

      var request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = function (event) {
        var db = event.target.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          var store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
          store.createIndex('createdAt', 'createdAt', { unique: false });
        }
      };

      request.onsuccess = function (event) {
        resolve(event.target.result);
      };

      request.onerror = function (event) {
        console.warn('IndexedDB open error:', event.target.error);
        resolve(null);
      };
    });

    return dbPromise;
  }

  var ReportStore = {
    getAllReports: async function () {
      var db = await openDatabase();
      if (!db) return [];

      return new Promise(function (resolve) {
        try {
          var tx = db.transaction(STORE_NAME, 'readonly');
          var store = tx.objectStore(STORE_NAME);
          var req = store.getAll();

          req.onsuccess = function () {
            var items = req.result || [];
            items.sort(function (a, b) {
              return a.createdAt < b.createdAt ? 1 : -1;
            });
            resolve(items);
          };

          req.onerror = function () {
            resolve([]);
          };
        } catch (err) {
          console.warn('Error reading from IndexedDB:', err);
          resolve([]);
        }
      });
    },

    getReportById: async function (id) {
      var db = await openDatabase();
      if (!db) return null;

      return new Promise(function (resolve) {
        try {
          var tx = db.transaction(STORE_NAME, 'readonly');
          var store = tx.objectStore(STORE_NAME);
          var req = store.get(id);

          req.onsuccess = function () {
            resolve(req.result || null);
          };

          req.onerror = function () {
            resolve(null);
          };
        } catch (err) {
          resolve(null);
        }
      });
    },

    saveReport: async function (report) {
      if (!report || !report.id) return false;
      var db = await openDatabase();
      if (!db) return false;

      return new Promise(function (resolve) {
        try {
          var tx = db.transaction(STORE_NAME, 'readwrite');
          var store = tx.objectStore(STORE_NAME);
          var req = store.put(report);

          req.onsuccess = function () {
            resolve(true);
          };

          req.onerror = function () {
            resolve(false);
          };
        } catch (err) {
          resolve(false);
        }
      });
    },

    saveReports: async function (reports) {
      if (!Array.isArray(reports) || reports.length === 0) return 0;
      var db = await openDatabase();
      if (!db) return 0;

      return new Promise(function (resolve) {
        try {
          var tx = db.transaction(STORE_NAME, 'readwrite');
          var store = tx.objectStore(STORE_NAME);
          var saved = 0;

          reports.forEach(function (r) {
            if (r && r.id) {
              store.put(r);
              saved++;
            }
          });

          tx.oncomplete = function () {
            resolve(saved);
          };

          tx.onerror = function () {
            resolve(saved);
          };
        } catch (err) {
          resolve(0);
        }
      });
    },

    exportReportsAsJson: async function () {
      var allReports = await this.getAllReports();
      if (allReports.length === 0) {
        alert('No archived reports to export.');
        return;
      }

      var payload = JSON.stringify(allReports, null, 2);
      var blob = new Blob([payload], { type: 'application/json' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      var dateStr = new Date().toISOString().split('T')[0];

      a.href = url;
      a.download = 'zenmoney-reports-backup-' + dateStr + '.json';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    },

    importReportsFromJsonFile: async function (file) {
      var self = this;
      return new Promise(function (resolve, reject) {
        if (!file) {
          reject(new Error('No file provided'));
          return;
        }

        var reader = new FileReader();
        reader.onload = async function (e) {
          try {
            var parsed = JSON.parse(e.target.result);
            var reportArray = Array.isArray(parsed) ? parsed : [parsed];

            var validReports = reportArray.filter(function (r) {
              return r && typeof r.id === 'string' && typeof r.markdownContent === 'string';
            });

            if (validReports.length === 0) {
              reject(new Error('Invalid backup file: no valid report records found.'));
              return;
            }

            await self.saveReports(validReports);

            // Sync imported records to server
            try {
              await fetch('/api/reports/reconcile', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ reports: validReports }),
              });
            } catch (syncErr) {
              console.warn('Server sync error on import (local storage succeeded):', syncErr);
            }

            resolve(validReports.length);
          } catch (err) {
            reject(new Error('Failed to parse JSON file: ' + err.message));
          }
        };

        reader.onerror = function () {
          reject(new Error('File reading failed.'));
        };

        reader.readAsText(file);
      });
    },

    syncWithServer: async function () {
      var localReports = await this.getAllReports();
      var localMap = new Map();
      localReports.forEach(function (r) {
        localMap.set(r.id, r);
      });

      // 1. Fetch server listing
      var serverReports = [];
      try {
        var res = await fetch('/api/reports');
        if (res.ok) {
          serverReports = await res.json();
        }
      } catch (err) {
        console.warn('Could not contact server to list reports:', err);
      }

      var serverIdSet = new Set(serverReports.map(function (r) { return r.id; }));

      // 2. Client -> Server: check if client has reports with markdown that server lacks
      var missingOnServer = [];
      localReports.forEach(function (local) {
        if (local.markdownContent && !serverIdSet.has(local.id)) {
          missingOnServer.push(local);
        }
      });

      if (missingOnServer.length > 0) {
        try {
          var reconcileRes = await fetch('/api/reports/reconcile', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ reports: missingOnServer }),
          });
          if (reconcileRes.ok) {
            var reconcileData = await reconcileRes.json();
            if (Array.isArray(reconcileData.reports)) {
              serverReports = reconcileData.reports;
            }
          }
        } catch (recErr) {
          console.warn('Reconcile push failed:', recErr);
        }
      }

      // 3. Server -> Client: check if server has reports missing locally
      var missingLocally = serverReports.filter(function (s) {
        return !localMap.has(s.id);
      });

      for (var i = 0; i < missingLocally.length; i++) {
        var meta = missingLocally[i];
        try {
          var detailRes = await fetch('/api/reports/' + meta.id);
          if (detailRes.ok) {
            var fullReport = await detailRes.json();
            await this.saveReport(fullReport);
            localMap.set(fullReport.id, fullReport);
          }
        } catch (detailErr) {
          // ignore individual fetch error
        }
      }

      return await this.getAllReports();
    },
  };

  global.ReportStore = ReportStore;
})(window);
