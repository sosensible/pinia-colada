import {
  IS_CLIENT,
  _JSONPrimitive,
  _MaybeArray,
  _ObjectFlat,
  computedRef,
  useEventListener,
} from './utils'
import {
  computed,
  onMounted,
  onServerPrefetch,
  toValue,
  onScopeDispose,
  getCurrentScope,
  watch,
  getCurrentInstance,
} from 'vue'
import { _UseQueryEntry_State, useQueryCache } from './query-store'
import {
  UseQueryOptions,
  UseQueryOptionsWithDefaults,
  useQueryOptions,
} from './query-options'
import { ErrorDefault } from './types-extension'

/**
 * Return type of `useQuery()`.
 */
export interface UseQueryReturn<TResult = unknown, TError = ErrorDefault>
  extends _UseQueryEntry_State<TResult, TError> {
  /**
   * Ensures the current data is fresh. If the data is stale, refetch, if not return as is.
   * @returns a promise that resolves when the refresh is done
   */
  refresh: () => Promise<TResult>

  /**
   * Ignores fresh data and triggers a new fetch
   * @returns a promise that resolves when the refresh is done
   */
  refetch: () => Promise<TResult>
}

/**
 * Ensures and return a shared query state based on the `key` option.
 *
 * @param _options - The options of the query
 */
export function useQuery<TResult, TError = ErrorDefault>(
  _options: UseQueryOptions<TResult>
): UseQueryReturn<TResult, TError> {
  const store = useQueryCache()
  const USE_QUERY_DEFAULTS = useQueryOptions()

  const options = {
    ...USE_QUERY_DEFAULTS,
    ..._options,
  } satisfies UseQueryOptionsWithDefaults<TResult>

  const entry = computed(() =>
    store.ensureEntry<TResult, TError>(toValue(options.key), options)
  )

  const refresh = () => store.refresh(entry.value)
  const refetch = () => store.refetch(entry.value)

  const queryReturn = {
    data: computedRef(() => entry.value.data),
    error: computedRef(() => entry.value.error),
    isFetching: computed(() => entry.value.isFetching.value),
    isPending: computed(() => entry.value.isPending.value),
    status: computedRef(() => entry.value.status),

    refresh,
    refetch,
  } satisfies UseQueryReturn<TResult, TError>

  const hasCurrentInstance = getCurrentInstance()

  if (hasCurrentInstance) {
    // only happens on server, app awaits this
    onServerPrefetch(async () => {
      await refresh()
      // TODO: after adding a test, remove these lines and refactor the const queryReturn to just a return statement
      // NOTE: workaround to https://github.com/vuejs/core/issues/5300
      // eslint-disable-next-line
      queryReturn.data.value,
        queryReturn.error.value,
        queryReturn.isFetching.value,
        queryReturn.isPending.value
    })
  }

  // should we be watching entry
  let isActive = false
  if (hasCurrentInstance) {
    onMounted(() => {
      isActive = true
      // add instance to Set of refs
    })
  } else {
    isActive = true
  }

  watch(entry, (entry, _, onCleanup) => {
    if (!isActive) return
    refresh()
    onCleanup(() => {
      // TODO: decrement ref count
    })
  })

  // only happens on client
  // we could also call fetch instead but forcing a refresh is more interesting
  if (options.refetchOnMount && hasCurrentInstance) {
    // TODO: optimize so it doesn't refresh if we are hydrating
    onMounted(() => {
      if (options.refetchOnMount) {
        if (options.refetchOnMount === 'always') {
          refetch()
        } else {
          refresh()
        }
      }
    })
  }
  // TODO: we could save the time it was fetched to avoid fetching again. This is useful to not refetch during SSR app but do refetch in SSG apps if the data is stale. Careful with timers and timezones

  if (getCurrentScope()) {
    onScopeDispose(() => {
      // TODO: add a reference count to the entry and garbage collect it if it's 0 after the given delay
    })
  }

  if (IS_CLIENT) {
    if (options.refetchOnWindowFocus) {
      useEventListener(document, 'visibilitychange', () => {
        if (document.visibilityState === 'visible') {
          if (options.refetchOnWindowFocus === 'always') {
            refetch()
          } else {
            refresh()
          }
        }
      })
    }

    if (options.refetchOnReconnect) {
      useEventListener(window, 'online', () => {
        if (options.refetchOnReconnect === 'always') {
          refetch()
        } else {
          refresh()
        }
      })
    }
  }

  options.setup?.({
    ...queryReturn,
    options,
  })

  return queryReturn
}
