"""Disposable real PostgreSQL check; never connects to an existing database."""
import concurrent.futures, pathlib, subprocess, time, uuid
root = pathlib.Path(__file__).resolve().parents[1]
name = 'pikl-release-' + uuid.uuid4().hex[:10]
def docker(*args, data=None, check=True):
    return subprocess.run(['docker', *args], input=data, text=True, capture_output=True, check=check)
def sql(statement, check=True):
    return docker('exec', '-i', name, 'psql', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1', '-At', data=statement, check=check)
try:
    docker('run', '-d', '--rm', '--name', name, '-e', 'POSTGRES_HOST_AUTH_METHOD=trust', 'postgres:17-alpine')
    for _ in range(60):
        if docker('exec', name, 'pg_isready', '-U', 'postgres', check=False).returncode == 0: break
        time.sleep(0.5)
    # Reuse the same Supabase role/schema stand-ins as unit tests.
    harness = (root/'src/sync/db/harness.ts').read_text()
    standins = harness.split('const SUPABASE_STANDINS = `', 1)[1].split('`;', 1)[0]
    sql(standins)
    for migration in sorted((root/'supabase/migrations').glob('*.sql')): sql(migration.read_text())
    owner = '00000000-0000-4000-8000-00000000000a'
    sql(f"insert into auth.users(id) values ('{owner}'); insert into public.attendance_links(owner_id,slot_id,title,weekday,code) values ('{owner}','test','Concurrency',1,'release-concurrency-code');")
    request = "begin; set local role anon; select public.attendance_add_guest('release-concurrency-code','Guest'); commit;"
    with concurrent.futures.ThreadPoolExecutor(max_workers=32) as pool:
        results = list(pool.map(lambda _: sql(request, check=False), range(40)))
    successes = sum(r.returncode == 0 for r in results)
    failures = [r for r in results if r.returncode != 0]
    count = int(sql('select count(*) from public.attendance_guests;').stdout.strip())
    assert successes == count == 20, (successes, count)
    assert all('too_many' in r.stderr for r in failures), [r.stderr for r in failures]
    print('PASS: 40 concurrent requests, exactly 20 accepted and 20 rejected at the cap.')
finally:
    docker('rm', '-f', name, check=False)
