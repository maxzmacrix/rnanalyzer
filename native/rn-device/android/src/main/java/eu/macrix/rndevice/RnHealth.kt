package eu.macrix.rndevice

import android.content.Context
import android.content.Intent
import androidx.health.connect.client.HealthConnectClient
import androidx.health.connect.client.PermissionController
import androidx.health.connect.client.permission.HealthPermission
import androidx.health.connect.client.records.HeartRateRecord
import androidx.health.connect.client.request.ReadRecordsRequest
import androidx.health.connect.client.time.TimeRangeFilter
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import java.time.Instant

/**
 * Health Connect bridge (Android counterpart of HealthKit): heart-rate samples for a time window.
 * Kotlin because the Health Connect client API is suspend-based.
 */
object RnHealth {
    private val PERMS = setOf(HealthPermission.getReadPermission(HeartRateRecord::class))
    private val contract = PermissionController.createRequestPermissionResultContract()

    /** 0 = available, 1 = Health Connect app missing/needs update, 2 = not supported on this device */
    @JvmStatic fun status(ctx: Context): Int = when (HealthConnectClient.getSdkStatus(ctx)) {
        HealthConnectClient.SDK_AVAILABLE -> 0
        HealthConnectClient.SDK_UNAVAILABLE_PROVIDER_UPDATE_REQUIRED -> 1
        else -> 2
    }

    @JvmStatic fun hasPermission(ctx: Context, cb: (Boolean, Throwable?) -> Unit) {
        CoroutineScope(Dispatchers.IO).launch {
            try {
                val granted = HealthConnectClient.getOrCreate(ctx).permissionController.getGrantedPermissions()
                cb(granted.containsAll(PERMS), null)
            } catch (e: Throwable) { cb(false, e) }
        }
    }

    @JvmStatic fun requestIntent(ctx: Context): Intent = contract.createIntent(ctx, PERMS)

    @JvmStatic fun parseGranted(resultCode: Int, data: Intent?): Boolean = contract.parseResult(resultCode, data).containsAll(PERMS)

    /** Heart-rate samples between fromMs and toMs → list of (epoch ms, bpm), sorted by time. */
    @JvmStatic fun readHeartRate(ctx: Context, fromMs: Long, toMs: Long, cb: (List<Pair<Long, Double>>?, Throwable?) -> Unit) {
        CoroutineScope(Dispatchers.IO).launch {
            try {
                val client = HealthConnectClient.getOrCreate(ctx)
                val out = ArrayList<Pair<Long, Double>>()
                var pageToken: String? = null
                do {
                    val req = ReadRecordsRequest(
                        recordType = HeartRateRecord::class,
                        timeRangeFilter = TimeRangeFilter.between(Instant.ofEpochMilli(fromMs), Instant.ofEpochMilli(toMs)),
                        pageSize = 1000,
                        pageToken = pageToken,
                    )
                    val res = client.readRecords(req)
                    for (rec in res.records) for (s in rec.samples) out.add(Pair(s.time.toEpochMilli(), s.beatsPerMinute.toDouble()))
                    pageToken = res.pageToken
                } while (pageToken != null)
                out.sortBy { it.first }
                cb(out, null)
            } catch (e: Throwable) { cb(null, e) }
        }
    }
}
