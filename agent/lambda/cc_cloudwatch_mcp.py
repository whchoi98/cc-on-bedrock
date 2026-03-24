"""
CC-on-Bedrock CloudWatch MCP Lambda - Container Insights metrics
ECS 클러스터 CPU/Memory/Network 메트릭 조회
"""
import json
import boto3
from datetime import datetime, timedelta

CLUSTER = "cc-on-bedrock-devenv"


def lambda_handler(event, context):
    params = event if isinstance(event, dict) else json.loads(event)
    t = params.get("tool_name", "get_container_metrics")
    args = params.get("arguments", params)

    try:
        if t == "get_container_metrics":
            return handle_metrics(args)
        return {"statusCode": 400, "body": json.dumps({"error": f"Unknown tool: {t}"})}
    except Exception as e:
        return {"statusCode": 500, "body": json.dumps({"error": str(e)})}


def handle_metrics(args):
    cw = boto3.client("cloudwatch")
    cluster = args.get("cluster", CLUSTER)
    minutes = int(args.get("minutes", 10))

    end = datetime.utcnow()
    start = end - timedelta(minutes=minutes)

    queries = [
        {"Id": "cpu", "MetricStat": {"Metric": {"Namespace": "ECS/ContainerInsights", "MetricName": "CpuUtilized", "Dimensions": [{"Name": "ClusterName", "Value": cluster}]}, "Period": 300, "Stat": "Average"}},
        {"Id": "cpuR", "MetricStat": {"Metric": {"Namespace": "ECS/ContainerInsights", "MetricName": "CpuReserved", "Dimensions": [{"Name": "ClusterName", "Value": cluster}]}, "Period": 300, "Stat": "Average"}},
        {"Id": "mem", "MetricStat": {"Metric": {"Namespace": "ECS/ContainerInsights", "MetricName": "MemoryUtilized", "Dimensions": [{"Name": "ClusterName", "Value": cluster}]}, "Period": 300, "Stat": "Average"}},
        {"Id": "memR", "MetricStat": {"Metric": {"Namespace": "ECS/ContainerInsights", "MetricName": "MemoryReserved", "Dimensions": [{"Name": "ClusterName", "Value": cluster}]}, "Period": 300, "Stat": "Average"}},
        {"Id": "netRx", "MetricStat": {"Metric": {"Namespace": "ECS/ContainerInsights", "MetricName": "NetworkRxBytes", "Dimensions": [{"Name": "ClusterName", "Value": cluster}]}, "Period": 300, "Stat": "Sum"}},
        {"Id": "netTx", "MetricStat": {"Metric": {"Namespace": "ECS/ContainerInsights", "MetricName": "NetworkTxBytes", "Dimensions": [{"Name": "ClusterName", "Value": cluster}]}, "Period": 300, "Stat": "Sum"}},
        {"Id": "tasks", "MetricStat": {"Metric": {"Namespace": "ECS/ContainerInsights", "MetricName": "TaskCount", "Dimensions": [{"Name": "ClusterName", "Value": cluster}]}, "Period": 300, "Stat": "Average"}},
        {"Id": "hosts", "MetricStat": {"Metric": {"Namespace": "ECS/ContainerInsights", "MetricName": "ContainerInstanceCount", "Dimensions": [{"Name": "ClusterName", "Value": cluster}]}, "Period": 300, "Stat": "Average"}},
    ]

    result = cw.get_metric_data(StartTime=start, EndTime=end, MetricDataQueries=queries)
    vals = {}
    for r in result.get("MetricDataResults", []):
        vals[r["Id"]] = r["Values"][0] if r["Values"] else 0

    cpu_used, cpu_res = vals.get("cpu", 0), vals.get("cpuR", 0)
    mem_used, mem_res = vals.get("mem", 0), vals.get("memR", 0)

    return ok({
        "cluster": cluster,
        "period_minutes": minutes,
        "cpu_utilized": round(cpu_used, 1),
        "cpu_reserved": round(cpu_res, 0),
        "cpu_pct": round(cpu_used / cpu_res * 100, 1) if cpu_res > 0 else 0,
        "memory_utilized_mib": round(mem_used, 0),
        "memory_reserved_mib": round(mem_res, 0),
        "memory_pct": round(mem_used / mem_res * 100, 1) if mem_res > 0 else 0,
        "network_rx_bytes": round(vals.get("netRx", 0)),
        "network_tx_bytes": round(vals.get("netTx", 0)),
        "task_count": round(vals.get("tasks", 0)),
        "host_count": round(vals.get("hosts", 0)),
    })


def ok(data):
    return {"statusCode": 200, "body": json.dumps(data, default=str, ensure_ascii=False)}
